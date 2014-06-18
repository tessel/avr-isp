var tessel = require('tessel');
var avrLib = require('../');
var Queue = require('sync-queue');

var fs = require('fs');

var isp = avrLib.use(tessel.port['A']);

var pageSize = 64;
var fileName = 'ir.hex';

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
            readPagesFromHexFile(fileName, function(err, pages){
              isp.flashImage(pages, pageSize, function(){
                isp.endProgramming(function(){
                  console.log('Done programming!');
                  // isp.startProgramming(function(){
                  //   isp.verifyImage(pages, pageSize, function(){
                  //     console.log(isp.incorrect,'bytes written incorrectly');
                  //   });
                  // });
                });
              });
            });
          });
        });
      });
    });
  }
})

function readPagesFromHexFile(fname, next){
  fs.readFile(fname, function(err, data){
    if (err){
      next(err);
    } else {
      var pos = {position: -1};
      var pageAddr = 0;
      var pages = [];

      ;(function readPage(position){
        if( position.position < data.length){
          pos = isp.readImagePage(pos.position, data, pageAddr, pageSize);
          pages.push({ pageBuffer:pos.page, address: pageAddr});
          pageAddr+=pageSize;
          setImmediate(readPage(pos));
        } else {
          next(null, pages);
        }
      })(pos)
    }
  });
}
