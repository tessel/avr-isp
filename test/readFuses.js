var tessel = require('tessel');
var avrLib = require('../');

var isp = avrLib.use(tessel.port['A']);

isp.startProgramming(function(){
  isp.readFuses(function(fuses){
    console.log(fuses);
    isp.endProgramming();
  });
});
