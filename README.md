# Tessel AVR ISP

Use this library to reflash the firmware on any Tessel module which uses an ATTiny44 microcontroller. Currently this includes the Ambient and IR modules.

## Example Usage
Use the file `flashAmbient.js` in the examples folder of this repo to reflash the firmware on the ambient module.

### Configuring Custom Firmware
If you have your own firmware you wish to flash to a module, first make sure it is compiled to [Intel HEX format](http://en.wikipedia.org/wiki/Intel_HEX). Next, place the `.hex` file in your project directory to ensure it gets uploaded to the Tessel with the script.

Finally, set the configuration parameters in the `.use` method as in the example script.

```js
var avrLib = require('../');

var isp = avrLib.use(tessel.port['A'], {
  pageSize : 64, // Microcontroller memory page size in bytes. 64 bytes for the ATTiny44
  fileName : 'my-firmware.hex' // File path to your custom firmware
});

```

### License
MIT or Apache 2.0, at your option  
