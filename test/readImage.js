var tessel = require('tessel');
var avrLib = require('../');

var isp = avrLib.use( tessel.port['A'], {fileName:'', pageSize:64});

var numPages = 23;

console.log('1..1');

console.log('# Starting tests');

isp.startProgramming(function(err){
  if (!err) {
    isp.readImage( numPages, function(err, pages){
      if (!err){
        console.log(pages.length == numPages ? 'ok' : 'not ok - wrong number of pages read');
        isp.endProgramming(function(){
          console.log('# Tests complete');
        });
      } else {
        console.log('not ok - ', err);
      }
    });
  } else {
    console.log('not ok - ', err);
  }
});
