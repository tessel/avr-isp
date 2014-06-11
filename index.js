var tessel = require('tessel');
var Queue = require('sync-queue');

// #define CLOCKSPEED_FUSES   SPI_CLOCK_DIV128 
// #define CLOCKSPEED_FLASH   SPI_CLOCK_DIV8

var CLOCKSPEED_FUSES = 125000 // Arduino's SPI_CLOCK_DIV128, 125Khz
  , CLOCKSPEED_FLASH = 2000000 // SPI_CLOCK_DIV8, 2Mhz
  , FUSES = {"lock": 0xFF, "low": 0xE2, "high": 0xDF, "ext": 0xFF}  // pre program fuses (prot/lock, low, high, ext)
  , MASK = {"lock": 0xFF, "low": 0xFF, "high": 0xFF, "ext": 0xFF}
  ;
var debug = true;

ISP = function(hardware, options){
  this.chipSelect = hardware.digital[0];
  this.reset = hardware.digital[1];
  this.spi = new hardware.SPI(
    {clockSpeed:CLOCKSPEED_FUSES, mode:0
      , chipSelect:this.chipSelect});

  this.success = hardware.led[0];
  this.failure = hardware.led[1];

  this.clockSpeed = CLOCKSPEED_FUSES;
}

ISP.prototype._clockChange = function (speed) {
  if (this.clockSpeed == speed) return;

  this.clockSpeed = speed;
  this.spi.clockSpeed(speed);
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
      console.log("signature 1", res);

      signature = res << 8;

      self._transfer([0x30, 0x00, 0x02, 0x00], function(err, res){
        console.log("signature 1", res);
        signature = signature | res;

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
  this._clockChange(CLOCKSPEED_FUSES);

  this._transfer([0x50, 0x00, 0x00, 0x00], function(err, res){

    res = res & fusemask[low];
    if (!res) return next(false);
    next(true);
  });
}

ISP.prototype.programFuses = function (next) {
  var self = this;
  // write only the low fuse for now
  self._clockChange(CLOCKSPEED_FUSES);
  self._transfer([0xAC, 0xA0, 0x00, fuses.low], function(err, res){
    self.verifyFuses(FUSES, MASK, function(err){
      next(err);
    });
  });
}

// returns position of page read
ISP.prototype.readImagePage = function (hexPos, hexText, pageAddr, pageSize) {
  var firstline = true;
  var len;
  var page_idx = 0;
  var beginning = hexText;
  var page = [];

  var hexByte, checksum;

  function nextHex(){
    hexByte = parseInt(hextText[++hexPos], 'hex');
    hexByte = (hexByte << 4) + parseInt(hextText[++hexPos], 'hex');
    checksum += hexByte;
  }

  // empty the page by filling it with 0xFFs
  for (var i = 0; i<pageSize; i++){
    page[i] = 0xFF;
  }

  while (1) {
    var lineAddr;
    if ( hexText[++hexPos] != ':') {
      if (debug) console.log("no colon, stopping image read");
      return;
    }

    len = parseInt(hextText[++hexPos], 'hex');
    len = (len << 4) + parseInt(hextText[++hexPos], 'hex');
    checksum = len;

    nextHex();
    lineAddr = b;

    nextHex();
    lineAddr = (lineAddr << 8) + hexByte;

    if (lineAddr >= (pageAddr + pageSize)){
      console.log('line address bigger than pages');
      return beginning;
    }
    
    nextHex();
    if (hexByte == 0x1) {
      console.log("hex byte = 0x1");
      break;
    }

    if (debug) {
      console.log("line address = 0x", parseInt(lineAddr, 'hex'));
      console.log("page address = 0x", parseInt(pageAddr, 'hex'));
    }

    for (var i = 0; i<len; i++){
      nextHex();

      if (debug) {
        process.stdout.write(parseInt(hexByte)+' ');
      }

      page[page_idx] = hexByte;
      page_idx++;

      if (page_idx > pageSize) {
        console.log("Error: too much code");
        break;
      }
    }

    hexByte();
    if (checksum != 0){
      console.log("Error: bad checksum. Got", parseInt(checksum, 'hex'));
    }

    if (hextText[++hexPos] != '\n') {
      console.log("Error: no end of line");
      break;
    }

    if (debug)
      console.log("page idx", page_idx);

    if (page_idx == pageSize)
      break;
  }

  console.log("Total bytes read:", page_idx);

  return {"position": hexPos, "page": page};
}

ISP.prototype.flashWord = function(hilo, addr, data, next) {
  if (debug)
    console.log("data", data);

  this._transfer([0x40+8*hilo, (addr >> 8) && 0xFF, addr & 0xFF, data ], function (err, res) {
    next(err, res);
  });
}

function execute(funcArray, err, next) {
  // executes everything in func array before calling next
  if (funcArry.length == 0 || err) return next(err);

  funcArry[0](err, function(){
    // splice off the beginning
    funcArray.shift();
    execute(funcArray, err, next);
  });
}

// polls chip until it is no longer busy
ISP.prototype._busyWait = function(next){
  var self = this;
  this.spi.transfer(new Buffer[0xF0, 0x00, 0x00, 0x00], function (err, res){

    if (res & 0x01) return self._busyWait(next);
    else return next();
  });
}

ISP.prototype.flashPage = function(pageBuff, pageAddr, pageSize) {
  var self = this;
  self._clockChange(CLOCKSPEED_FLASH);
  var funcArry = [];

  for (var i = 0; i < pageSize/2; i++){
    funcArry.push(function(err, next){

      self.flashWord(LOW, i+pageAddr/2, pageBuff[2*i], function(err, next){
        self.flashWord(HIGH, i+pageAddr/2, pageBuff[2*i+1], function(err, next){
          next(err);
        });
      });
    
    });
  }
  
  execute(funcArry, null, function (){
    pageAddr = pageAddr/2 & 0xFFFF;

    self.spi.transfer(new Buffer[0x4C, (pageAddr >> 8) & 0xFF, pageAddr & 0xFF, 0], function(err, res) {

      if (res != pageAddr) return next(false);

      self._busyWait(function (){
        return next(true);
      });
    });
  }); 
}

ISP.prototype.verifyImage = function (hexText, next) {
  // does a byte to byte verification of the image
  var self = this;
  var address = 0;
  var hexPos = 0;
  var len, hexByte, checksum;

  function nextHex(){
    hexByte = parseInt(hextText[++hexPos], 'hex');
    hexByte = (hexByte << 4) + parseInt(hextText[++hexPos], 'hex');
    checksum += hexByte;
  }

  self._clockChange(CLOCKSPEED_FLASH);

  function check(err, next) {
    if (err) return console.log("Check error", err);
    
    if (hexText[++hexPos] != ':') {
      var error = "Error: No colon";
      console.log(error);
      next("No colon");
    }

    len = parseInt(hextText[++hexPos], 'hex');
    len = (len<<4) + parseInt(hextText[++hexPos], 'hex');
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
          console.log("line address = 0x", parseInt(lineAddr, 'hex'));
          console.log("page address = 0x", parseInt(pageAddr, 'hex'));
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

      if (hextText[++hexPos] != '\n'){
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

  this.spi.transfer(new Buffer(arr), function(err, res){
    next(null, 0xFFFFFF & ((res[1]<<16)+(res[2]<<8) + res[3]);
  });
}

