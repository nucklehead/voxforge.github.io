// use about:debugging#workers in firefox to get at web worker

// manually rewritten from CoffeeScript output
// (see dev-coffee branch for original source)
importScripts('../lib/WavAudioEncoder.js'); 
importScripts('../scripts/Vad.js'); 

var buffers = undefined;
var encoder = undefined;
var vad = undefined;

self.onmessage = function(event) {
  var data = event.data;

  switch (data.command) {
    case 'start':
      buffers = [];
      encoder = new WavAudioEncoder(data.sampleRate);
      if ( data.with_vad ) {
          vad = new Vad(data.sampleRate);
          console.log('VAD enabled');
      } else {
          console.log('VAD disabled');
      }
      break;

    case 'record':
      buffers.push(data.event_buffer);
      if ( data.with_vad ) {
         vad.calculateSilenceBoundaries(data.event_buffer, buffers.length - 1);
      }
      break;

    case 'finish':
      var speech_array, 
          no_speech, 
          no_trailing_silence, 
          clipping, 
          too_soft;
      if ( data.with_vad  ) {
        [speech_array, no_speech, no_trailing_silence, clipping, too_soft] = 
            vad.getSpeech(buffers);
        while (speech_array.length > 0) {
          encoder.encode(speech_array.shift());
        }
      } else {
        while (buffers.length > 0) {
          encoder.encode(buffers.shift());
        }
      }

      self.postMessage({ 
        blob: encoder.finish(),
        no_trailing_silence: no_trailing_silence,
        no_speech: no_speech,
        clipping: clipping,
        too_soft: too_soft,

      });

      encoder = undefined;
      break;

    case 'cancel':
      encoder.cancel();
      encoder = undefined;
  }
};
