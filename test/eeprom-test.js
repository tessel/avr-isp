var avrLib = require('../');
var test = require('tinytap');
var tessel = require('tessel');
var async = require('async');
var port = 'A' || process.argv[2];
var isp;

test.count(5);

async.series([

  test('can create an ISP object', function(t) {
    isp = avrLib.use(tessel.port['A'], { pageSize : 64});
    t.ok(isp, "can't create an ISP object");
    t.end();
  }),

  test('can read and write a single byte', function(t) {
    var testByte = 0x27;
    var address = 0x0;
    isp.writeEEPROMByte(testByte, address, function(err, response) {
      t.equal(err, undefined, 'error writing single byte');
      isp.readEEPROMByte(address, function(err, response) {
        t.equal(err, undefined, 'error retrieving byte');
        t.equal(4, response.length, 'invalid return length');
        t.equal(response[response.length-1], testByte);
        t.end();
      })
    })
  }),
  ],
  function(err) {
    console.log("Error running tests.", err);
  }
);


