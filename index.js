var tessel = require('tessel');
var Queue = require('sync-queue');
var fs = require('fs');

var CLOCKSPEED_FUSES = 125000 // Arduino's SPI_CLOCK_DIV128, 125Khz
  , CLOCKSPEED_FLASH = 2000000 // SPI_CLOCK_DIV8, 2Mhz
  , FUSES = {"lock": 0xFF, "low": 0xE2, "high": 0xDF, "ext": 0xFF}  // pre program fuses (prot/lock, low, high, ext)
  , MASK = {"lock": 0xFF, "low": 0xFF, "high": 0xFF, "ext": 0xFF}
  , HIGH = 0x01
  , LOW = 0x00
  ;
var debug = false;

ISP = function(hardware, options){
  this.chipSelect = hardware.digital[0].output().high();
  this.reset = hardware.digital[1].output().high();
  this.spi = new hardware.SPI(
    {clockSpeed:CLOCKSPEED_FUSES, mode:0
    });

  this.success = tessel.led[0];
  this.programming = tessel.led[1];

  this.pageSize = options.pageSize;
  this.fname = options.fileName

  this.clockSpeed = CLOCKSPEED_FUSES;

  this.incorrect = 0;
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

  self.startProgramming(function(err){
    if (!err){
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
    } else {
      next(err);
    }
  });

}

ISP.prototype.verifyFuses = function (fuses, mask, next) {
  // verifies only the low fuse for now
  var self = this;
  var queue = new Queue();

  queue.place(function verifyLow(){
    self._transfer([0x50, 0x00, 0x00, 0x00], function(err, res){
      if (res[3] & mask.low) {
        return next();
      } else {
        return next(new Error('Could not verify low fuse'));
      }
    });
  });

}

ISP.prototype.programFuses = function (next) {
  var self = this;
  // write only the low fuse for now
  var queue = new Queue();

  queue.place(function programLow(){
    self._transfer([0xAC, 0xA0, 0x00, FUSES.low], function(err, res){
      self.verifyFuses(FUSES, MASK, function(err){
        self.endProgramming(function(){
          if (err){
            next(err);
          } else {
            next();
          }
        });
      });
    });
  });

}

ISP.prototype.readPagesFromHexFile = function(next){
  var self = this;
  fs.readFile(self.fname, function(err, data){
    if (err){
      if (debug)
        console.log('File read error!', err);
      next(err);
    } else {
      var pos = {position: -1};
      var pageAddr = 0;
      var pages = [];

      ;(function readPage(position){
        if( position.position < data.length){
          pos = self.readImagePage(pos.position, data, pageAddr);
          pages.push({ pageBuffer:pos.page, address: pageAddr});
          pageAddr+=self.pageSize;
          setImmediate(readPage(pos));
        } else {
          next(null, pages);
        }
      })(pos)
    }
  });
}

// returns position of page read
ISP.prototype.readImagePage = function (hexPos, hexText, pageAddr) {
  var self = this;

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
  for (var i = 0; i<self.pageSize; i++){
    page[i] = 0xFF;
  }

  while (1) {
    var lineAddr;
    if ( hexText[++hexPos] != 0x3a) { // 0x3a == ':'
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

    if (lineAddr >= (pageAddr + self.pageSize)){
      console.log('Error: line address bigger than pages', lineAddr);
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

      page[page_idx] = hexByte;
      page_idx++;

      if (page_idx > self.pageSize) {
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

    if (page_idx == self.pageSize)
      break;
  }

  debug && console.log("Total bytes read:", page_idx);

  return {"position": hexPos, "page": new Buffer(page)};
}

ISP.prototype.flashImage = function(pages, next){
  var self = this;

  var queue = new Queue();

  var commands = [];

  for (var i=0; i<pages.length; i++){
    queue.place(function(i){
      debug && console.log(i, pages[i].pageBuffer);
      commands.push(self.queuePage(pages[i].pageBuffer, pages[i].address ));
        if (i+1 < pages.length){
          queue.next();
        } else {
          self.startProgramming(function(){
            self.flashAll(commands, next);
          });
        }
    }.bind(this, i));
  }
}

ISP.prototype.flashAll = function(commands, next){
  if (debug)
    console.log('starting flash');
  var self = this;
  if (commands.length){
    self._transfer(commands[0], function(){
      commands.shift();
      self.flashAll(commands, next);
    });
  } else {
    self.endProgramming(function(){
      next();
    });
  }
}

ISP.prototype.queuePage = function(pageBuff, pageAddr, next) {
  var self = this;

  var queue = new Queue();
  var spiQueue = [];


  for (var i = 0; i < self.pageSize/2; i++){
    var addr = i+pageAddr/2
    spiQueue.push(0x40, (addr >> 8) & 0xFF, addr & 0xFF, pageBuff[2*i]);
    spiQueue.push(0x48, (addr >> 8) & 0xFF, addr & 0xFF, pageBuff[2*i+1]);
    if ( i+1 == self.pageSize/2 ) {
      pageAddr = pageAddr/2 & 0xFFFF;
      spiQueue.push(0x4c, (pageAddr >> 8) & 0xFF, pageAddr & 0xFF, 0x00);
      return spiQueue
    }
  }
}

ISP.prototype.verifyImage = function(pages, next) {
  var self = this;

  var queue = new Queue();

  for (var i=0; i<pages.length; i++){
    queue.place(function(i){
      console.log(i, pages[i].pageBuffer);
      self.readPage(pages[i].pageBuffer, pages[i].address, function(){
        if (i+1 < pages.length){
          queue.next();
        } else {
          next();
        }
      });
    }.bind(this, i));
  }
}

ISP.prototype.readPage = function(pageBuff, pageAddr, next) {
  var self = this;

  var queue = new Queue();

  for (var i = 0; i < self.pageSize/2; i++){
    queue.place(function(i){
      self.readWord(LOW, i+pageAddr/2, pageBuff[2*i], function(err, res){
        self.readWord(HIGH, i+pageAddr/2, pageBuff[2*i+1], function(err, res){
          if (i+1 < self.pageSize/2 ){
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

  this._transfer([0x20+8*hilo, (addr >> 8) & 0xFF, addr & 0xFF, 0x00 ], function (err, res) {
    if ( data != res[3]){
      console.log('Error verifying data. Expected', data,', got', res[3], 'at 0x', addr.toString(16));
      self.incorrect++;
      next(err, res);
    } else {
      next(err, res);
    }
  });
}

ISP.prototype.startProgramming = function (next) {
  var self = this;
  self.reset.write(1);
  setTimeout(function(){
    self.reset.write(0);
    self.programming.write(1);
    self.spi.transfer(new Buffer([0xAC, 0x53, 0x00, 0x00]), function(err, rec){
      if (debug)
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
  this.reset.write(1);
  this.programming.write(0);
  next();
}

ISP.prototype.eraseChip = function(next){
  var self = this;

  self._transfer([0xAC, 0x80, 0, 0], function (err){
    if (debug) console.log("sent erase, waiting for done signal");
    self._busyWait(function(){
      next();
    });
  });
}

ISP.prototype._transfer = function (arr, next){
  if (arr.length%4 != 0) {
    var err = "isp transfer called with wrong size. needs to be 4 bytes, got "+arr;
    console.log(err);
    return next(err);
  }

  debug && console.log(arr.map(function(e){ return e.toString(16) }));

  this.spi.transfer(new Buffer(arr), function(err, res){
    next(null, res);
  });
}

// polls chip until it is no longer busy
ISP.prototype._busyWait = function(next){
  var self = this;
  this.spi.transfer(new Buffer([0xF0, 0x00, 0x00, 0x00]), function (err, res){

    if (res[3] & 1) return self._busyWait(next);
    else return next();
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
