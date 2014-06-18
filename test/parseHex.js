var tessel = require('tessel');
var avrLib = require('../');
var Queue = require('sync-queue');

var fs = require('fs');

var isp = avrLib.use(tessel.port['A']);

var pageSize = 64;

isp.startProgramming(function(err){
  if (!err){
    isp.readSignature(function(err, sig){
      err && console.log(err);
      isp.eraseChip(function(){
        console.log("Chip erased!");
        isp.programFuses(function(err){
          err && console.log(err);
          isp.endProgramming(function(){
            readPagesFromHexFile('ambient-attx4.hex', function(err, pages){
              isp.flashImage(pages, pageSize, function(){
                isp.endProgramming(function(){
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
