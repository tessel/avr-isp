var tessel = require('tessel');
var Queue = require('sync-queue');

// #define CLOCKSPEED_FUSES   SPI_CLOCK_DIV128
// #define CLOCKSPEED_FLASH   SPI_CLOCK_DIV8

var CLOCKSPEED_FUSES = 125000 // Arduino's SPI_CLOCK_DIV128, 125Khz
  , CLOCKSPEED_FLASH = 2000000 // SPI_CLOCK_DIV8, 2Mhz
  , FUSES = {"lock": 0xFF, "low": 0xE2, "high": 0xDF, "ext": 0xFF}  // pre program fuses (prot/lock, low, high, ext)
  , MASK = {"lock": 0xFF, "low": 0xFF, "high": 0xFF, "ext": 0xFF}
  , HIGH = 0x01
  , LOW = 0x00
  ;
var debug = false;

ISP = function(hardware, options){
  this.chipSelect = hardware.digital[0];
  this.reset = hardware.digital[1];
  this.spi = new hardware.SPI(
    {clockSpeed:CLOCKSPEED_FUSES, mode:0
      , chipSelect:this.chipSelect});

  this.success = tessel.led[0];
  this.programming = tessel.led[1];

  this.clockSpeed = CLOCKSPEED_FUSES;
}

ISP.prototype._clockChange = function (speed) {
  if (this.clockSpeed == speed) return;

  this.clockSpeed = speed;
  this.spi.setClockSpeed(speed);
}

// reads bottom 2 signature bytes and returns it
ISP.prototype.readSignature = function(next){
  var self = this;
  if (debug)
    console.log("Reading signature");

  var signature;
  self._clockChange(CLOCKSPEED_FUSES);

  self._transfer([0x30, 0x00, 0x00, 0x00], function(err, res){
    self._transfer([0x30, 0x00, 0x01, 0x00], function(err, res){
      if (debug)
        console.log("signature 1", res[3]);

      signature = res[3] << 8;

      self._transfer([0x30, 0x00, 0x02, 0x00], function(err, res){
        if (debug)
          console.log("signature 2", res[3]);
        signature = signature | res[3];

        if (debug)
          console.log("got signature", signature);

        if (signature == 0 || signature == 0xFFFF) {
          return next("Could not find a signature", signature);
        }

        return next(null, signature);
      });
    });
  });
}

ISP.prototype.verifyFuses = function (fuses, mask, next) {
  // verifies only the low fuse for now
  var self = this;
  self._clockChange(CLOCKSPEED_FUSES);
  var queue = new Queue();

  queue.place(function verifyLock(){
    self._transfer([0x58, 0x00, 0x00, 0x00], function(err, res){
      if (res[3] & mask.lock) {
        queue.next();
      } else {
        return next(new Error('Could not verify lock fuse'));
      }
    });
  });

  queue.place(function verifyLow(){
    self._transfer([0x50, 0x00, 0x00, 0x00], function(err, res){
      if (res[3] & mask.low) {
        queue.next();
      } else {
        return next(new Error('Could not verify low fuse'));
      }
    });
  });

  queue.place(function verifyHigh(){
    self._transfer([0x58, 0x08, 0x00, 0x00], function(err, res){
      if (res[3] & mask.high) {
        queue.next();
      } else {
        return next(new Error('Could not verify high fuse'));
      }
    });
  });

  queue.place(function verifyExt(){
    self._transfer([0x50, 0x08, 0x00, 0x00], function(err, res){
      if (res[3] & mask.ext) {
        return next();
      } else {
        return next(new Error('Could not verify ext fuse'));
      }
    });
  });

}

ISP.prototype.programFuses = function (next) {
  var self = this;
  // write only the low fuse for now
  self._clockChange(CLOCKSPEED_FUSES);
  var queue = new Queue();

  queue.place(function programLock(){
    self._transfer([0xAC, 0xE0, 0x00, FUSES.lock], function(err, res){
      queue.next();
    });
  });

  queue.place(function programLow(){
    self._transfer([0xAC, 0xA0, 0x00, FUSES.low], function(err, res){
      queue.next();
    });
  });

  queue.place(function programHigh(){
    self._transfer([0xAC, 0xA8, 0x00, FUSES.high], function(err, res){
      queue.next();
    });
  });

  queue.place(function programExt(){
    self._transfer([0xAC, 0xA4, 0x00, FUSES.ext], function(err, res){
      self.verifyFuses(FUSES, MASK, function(err){
        if (err){
          next(err);
        }else{
          next();
        }
      });
    });
  });

}

// returns position of page read
ISP.prototype.readImagePage = function (hexPos, hexText, pageAddr, pageSize) {
  var len;
  var page_idx = 0;
  var beginning = hexText;
  var page = [];

  var hexByte, checksum;

  function nextHex(){
    hexByte = hexToN(hexText[++hexPos]);
    hexByte = (hexByte << 4) + hexToN(hexText[++hexPos]);
    checksum += hexByte;
  }

  // initiate the page by filling it with 0xFFs
  for (var i = 0; i<pageSize; i++){
    page[i] = 0xFF;
  }

  while (1) {
    var lineAddr;
    if ( hexText[++hexPos] != 0x3a) {
      console.log('dump', hexPos, hexText[hexPos-2],hexText[hexPos-1],hexText[hexPos],hexText[hexPos+1]);
      if (debug) console.log("no colon, stopping image read");
      return;
    }

    len = hexToN(hexText[++hexPos]);
    len = (len << 4) + hexToN(hexText[++hexPos]);
    checksum = len;
    debug && console.log('Len',len);

    // High address byte
    nextHex();
    lineAddr = hexByte;

    // Low address byte
    nextHex();
    lineAddr = (lineAddr << 8) + hexByte;

    if (lineAddr >= (pageAddr + pageSize)){
      console.log('line address bigger than pages', lineAddr);
      return beginning;
    }

    nextHex();
    // Check record type
    if (hexByte == 0x1) {
      debug && console.log("EOF record: 0x1");
      hexPos=hexText.length;
      break;
    }

    if (debug) {
      console.log("line address = 0x", lineAddr);
      console.log("page address = 0x", pageAddr);
    }

    for (var i = 0; i<len; i++){
      nextHex();

      if (debug) {
        console.log(hexByte+' ');
      }

      page[page_idx] = hexByte;
      page_idx++;

      if (page_idx > pageSize) {
        console.log("Error: too much code");
        break;
      }
    }

    nextHex();
    if (checksum%256 != 0){
      console.log("Error: bad checksum. Got", checksum);
    }

    hexPos++;
    if (hexText[hexPos] != 0x0d) {
      if (hexText[hexPos] != 0x0a){
        console.log("Error: no end of line");
        break;
      }
    } else {
      if (hexText[++hexPos] != 0x0a){
        console.log("Error: no end of line");
        break;
      }
    }

    if (debug)
      console.log("page idx", page_idx);

    if (page_idx == pageSize)
      break;
  }

  debug && console.log("Total bytes read:", page_idx);

  return {"position": hexPos, "page": new Buffer(page)};
}

function flashPages(pages, next){
  var self = this;

  var queue = new Queue();

  for (var i=0; i<pages.length; i++){
    queue.place(function(i){
      console.log(i, pages[i].pageBuffer);
      self.flashPage(pages[i].pageBuffer, pages[i].address, pageSize, function(flashed){
        console.log(flashed);
        queue.next();
      });
    }.bind(this, i));
  }
}

ISP.prototype.flashPage = function(pageBuff, pageAddr, pageSize, next) {

  var self = this;
  self._clockChange(CLOCKSPEED_FLASH);
  // var funcArry = [];

  var queue = new Queue();

  for (var i = 0; i < pageSize/2; i++){
    queue.place(function(i){
      self.flashWord(LOW, i+pageAddr/2, pageBuff[2*i], function(err, res){
        self.flashWord(HIGH, i+pageAddr/2, pageBuff[2*i+1], function(err, res){
          if (i+1 < pageSize/2 ){
            queue.next();
          } else {
            console.log('End of page reached');
            finishPage();
          }
        });
      });
    }.bind(this, i));
  }

  function finishPage(){
    pageAddr = pageAddr/2 & 0xFFFF;

    self.spi.transfer(new Buffer([0x4c, (pageAddr >> 8) & 0xFF, pageAddr & 0xFF, 0x00]), function(err, res){
      self._busyWait(function(){
        next(true);
      });
    });
  }
}

ISP.prototype.flashWord = function(hilo, addr, data, next) {
  var self = this;
  if (debug)
    console.log("data", data);

  this._transfer([0x40+8*hilo, (addr >> 8) && 0xFF, addr & 0xFF, data ], function (err, res) {
    // if ( res[2] == ((addr >> 8) && 0xFF) && res[3] == (addr & 0xFF) ) {
      next(err, res);
    // } else {
      // console.log('SPI response', res);
      // console.log('Incorrect address written, retrying...');
      // self.flashWord( hilo, addr, data, next);
    // }
  });
}

function execute(funcArray, err, next) {
  // executes everything in func array before calling next
  if (funcArray.length == 0 || err) return next(err);

  funcArray[0](err, function(){
    // splice off the beginning
    funcArray.shift();
    execute(funcArray, err, next);
  });
}

// polls chip until it is no longer busy
ISP.prototype._busyWait = function(next){
  var self = this;
  this.spi.transfer(new Buffer([0xF0, 0x00, 0x00, 0x00]), function (err, res){

    if (res & 0x01) return self._busyWait(next);
    else return next();
  });
}

ISP.prototype.verifyImage = function(pages, next) {
  var self = this;

  var queue = new Queue();

  for (var i=0; i<pages.length; i++){
    queue.place(function(i){
      console.log(i, pages[i].pageBuffer);
      self.readPage(pages[i].pageBuffer, pages[i].address, pageSize, function(flashed){
        console.log(flashed);
        queue.next();
      });
    }.bind(this, i));
  }
}

ISP.prototype.readPage = function(pageBuffer, pageAddr, pageSize, next) {
  var self = this;
  self._clockChange(CLOCKSPEED_FLASH);
  // var funcArry = [];

  var queue = new Queue();

  for (var i = 0; i < pageSize/2; i++){
    queue.place(function(i){
      self.readWord(LOW, i+pageAddr/2, pageBuff[2*i], function(err, res){
        self.readWord(HIGH, i+pageAddr/2, pageBuff[2*i+1], function(err, res){
          if (i+1 < pageSize/2 ){
            queue.next();
          } else {
            console.log('End of page reached');
            next();
          }
        });
      });
    }.bind(this, i));
  }

}

ISP.prototype.readWord = function(hilo, addr, data, next) {
  var self = this;
  if (debug)
    console.log("data", data);

  this._transfer([0x20+8*hilo, (addr >> 8) && 0xFF, addr & 0xFF, 0x00 ], function (err, res) {
    console.log('These should match', data, res[3]);
    // if ( res[2] == ((addr >> 8) && 0xFF) && res[3] == (addr & 0xFF) ) {
      next(err, res);
    // } else {
      // console.log('SPI response', res);
      // console.log('Incorrect address written, retrying...');
      // self.flashWord( hilo, addr, data, next);
    // }
  });
}

ISP.prototype.verifyImage = function (hexText, next) {
  // does a byte to byte verification of the image
  var self = this;
  var address = 0;
  var hexPos = 0;
  var len, hexByte, checksum;

  function nextHex(){
    hexByte = hexToN(hexText[++hexPos]);
    hexByte = (hexByte << 4) + hexToN(hexText[++hexPos]);
    checksum += hexByte;
  }

  self._clockChange(CLOCKSPEED_FLASH);

  function check(err, next) {
    if (err) return console.log("Check error", err);

    if (hexText[++hexPos] != 0x3a) {
      var error = "Error: No colon";
      console.log(error);
      next("No colon");
    }

    len = hexToN(hexText[++hexPos]);
    len = (len<<4) + hexToN(hexText[++hexPos]);
    checksum = len;

    nextHex();
    lineAddr = hexByte;

    nextHex();
    lineAddr = (lineAddr << 8) + hexByte;

    nextHex();

    if (hexByte == 0x1){
      if (debug) console.log("ending it now");

      next(null);
    }

    var funcArry = [];
    for (var i = 0; i < len; i++){
      funcArry.push(function(err, next){
        nextHex();

        if (debug) {
          console.log("line address = 0x", lineAddr);
          console.log("page address = 0x", pageAddr);
        }

        if (lineaddr % 2) {
          // high byte
          self._transfer([0x28, lineAddr >> 9, lineAddr/2, 0], function (err, res){
            if (hexByte != res && 0xFF) {
              console.log("verification error at", lineAddr);
              console.log("should be", parseInt(hexByte, 'hex'), "not", parseInt(res & 0xFF, 'hex'));
              return next("verification error");
            }
            return next();

          });
        } else {
          // low byte
          self._transfer([0x20, lineAddr >> 9, lineAddr/2, 0], function (err, res) {
            if (hexByte != res && 0xFF) {
              console.log("verification error at", lineAddr);
              console.log("should be", parseInt(hexByte, 'hex'), "not", parseInt(res & 0xFF, 'hex'));
              return next("verification error");
            }

            return next();
          });
        }
      });
    }

    execute(funcArry, null, function(err){
      lineaddr++;

      nextHex();
      if (checksum != 0) {
        console.log('bad checksum');
        return check('bad checksum');
      }

      if (hexText[++hexPos] != '\n'){
        console.log("no end of line");
        return check('no end of line');
      }
      check(err, next);
    });
  }

  check(null, function(err){
    next(err);
  });
}

ISP.prototype.startProgramming = function (next) {
  var self = this;
  self.reset.output(1);
  setTimeout(function(){
    self.reset.output(0);
    self.programming.write(1);
    self.spi.transfer(new Buffer([0xAC, 0x53, 0x00, 0x00]), function(err, rec){
      console.log("SPI response", rec);
      if (rec && rec[2] == 0x53){
        next()
      } else {
        next(new Error('Programming confirmation not received.'));
      }
    });
  },50);
}

ISP.prototype.endProgramming = function (next) {
  this.reset.output(0);
  next();
}

ISP.prototype.eraseChip = function(next){
  var self = this;
  self._clockChange(CLOCKSPEED_FUSES);

  self._transfer([0xAC, 0x80, 0, 0], function (err){
    if (debug) console.log("sent erase, waiting for done signal");
    self._busyWait(function(){
      next();
    });
  });
}

ISP.prototype._transfer = function (arr, next){
  if (arr.length != 4) {
    var err = "isp transfer called with wrong size. needs to be 4 bytes, got "+arr;
    console.log(err);
    return next(err);
  }

  console.log(arr.map(function(e){ return e.toString(16) }));

  this.spi.transfer(new Buffer(arr), function(err, res){
    next(null, res);// 0xFFFFFF & ((res[1]<<16)+(res[2]<<8) + res[3]));
  });
}

function hexToN(hex) {
  if (hex >= 0x30 && hex <= 0x39) {
    return hex - 0x30;
  }
  if (hex >= 0x41 && hex <= 0x46){
    return (hex - 0x41) + 10;
  }
}

function use (hardware, options) {
  return new ISP(hardware, options);
}

module.exports.ISP = ISP;
module.exports.FUSES = FUSES;
module.exports.MASK = MASK;
module.exports.use = use;
