var tessel = require('tessel');
var avrLib = require('../');
var Queue = require('sync-queue');

var fs = require('fs');

var isp = avrLib.use(tessel.port['A'], {pageSize : 64, fileName : 'ambient-attx4.hex'});

isp.startProgramming(function(err){
  if (!err){
    console.log('Verifying signature...');
    isp.readSignature(function(err, sig){
      err && console.log(err);
      console.log('Verified');
      isp.eraseChip(function(){
        console.log("Flash cleared.");
        isp.programFuses(function(err){
          err && console.log(err);
          isp.endProgramming(function(){
            console.log('Parsing hex file...');
            isp.readPagesFromHexFile(function(err, pages){
              err && console.log('Parse error: ',err);
              console.log('Flashing chip memory');
              isp.flashImage(pages, function(){
                isp.endProgramming(function(){
                  console.log('Done programming!');
                });
              });
            });
          });
        });
      });
    });
  }
})
