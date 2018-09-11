/*
Copyright 2018 VoxForge

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

importScripts('../lib/WavAudioEncoder.js'); 
importScripts('../scripts/Vad.js'); 

var buffers = undefined;
var encoder = undefined;
var vad = undefined;
var vad_run = undefined;
var vad_parms = undefined;
var prompt_id = undefined;
var ssd_parms = undefined;
var starttime = 0;

self.onmessage = function(event) {
  var data = event.data;

  switch (data.command) {
    case 'start':
      starttime = Date.now();

      prompt_id = data.prompt_id;
      buffers = [];

      // TODO this should be done in Audio and not everytime record is pressed...
      var bitDepth = data.bitDepth;
      if ( ! (bitDepth === 16 || bitDepth === "32bit-float") ) {
        console.warn("invalid bit depth: " + data.bitDepth + "; setting to 16 bit");
        bitDepth = "32bit-float";
      } 
      console.log('bitDepth: ' + bitDepth);
      encoder = new WavAudioEncoder(data.sampleRate, bitDepth);

      vad_run = data.vad_run;
      ssd_parms = data.ssd_parms;

      if ( vad_run ) {
          vad = new Vad(data.sampleRate, data.vad_parms);
          vad_parms = data.vad_parms;
      } else {
         console.log('VAD disabled');
      }
      break;

    case 'record':
      buffers.push(data.event_buffer); // array of buffer arrays
      // TODO either use this code or remove it!
      //startSimpleSilenceDetection(buffers.length - 1, data.event_buffer);

      if ( vad_run ) {
          //vad.calculateSilenceBoundaries(data.event_buffer, buffers.length - 1);
          // split buffer up into smaller chunks that VAD can digest
          let num_chunks = 4;
          let cutoff = Math.round(data.event_buffer.length / num_chunks);
          let buffers_index = buffers.length - 1;
          for (let i = 0; i < num_chunks; i++) {
            let chunk_index = i;
            let start = i * cutoff;
            let end = (i * cutoff) + cutoff
            // slice extracts up to but not including end.
            let chunk = data.event_buffer.slice(start, end);
            vad.calculateSilenceBoundaries(chunk, buffers_index, chunk_index);
          }
      }
      break;

    case 'finish':
      var speech_array = null;
      var no_speech = false;
      var no_trailing_silence = false; 
      var clipping = false;
      var too_soft = false;
      if ( vad_run ) {
        // need test for trailing and leading noise detection...
        [speech_array, no_speech, no_trailing_silence, clipping, too_soft] = 
            vad.getSpeech(buffers);
        while (speech_array.length > 0) {
          encoder.encode(speech_array.shift(), );
        }
      } else {
        while (buffers.length > 0) {
          encoder.encode(buffers.shift());
        }
      }

      self.postMessage({
          status: 'finished',
          obj : { 
            prompt_id: prompt_id,
            blob: encoder.finish(), // convert audio from float to wav int16 or 32-bit float
            no_trailing_silence: no_trailing_silence,
            no_speech: no_speech,
            clipping: clipping,
            too_soft: too_soft,
            vad_run: vad_run,
          }
      });

      encoder = undefined;
      break;

    case 'cancel':
      encoder.cancel();
      encoder = undefined;
  }
};



// using frequency domain data and minDecibels to detect silence
// https://stackoverflow.com/questions/46543341/how-can-i-extract-the-preceding-audio-from-microphone-as-a-buffer-when-silence?utm_medium=organic&utm_source=google_rich_qa&utm_campaign=google_rich_qa
// zero crossings:
// https://dsp.stackexchange.com/questions/1178/using-short-time-energy-and-zero-crossing-rate?utm_medium=organic&utm_source=google_rich_qa&utm_campaign=google_rich_qa
// https://github.com/cwilso/web-audio-samples/blob/master/samples/audio/zero-crossings.html

// see: https://aws.amazon.com/blogs/machine-learning/capturing-voice-input-in-a-browser/
// this is only useful in quiet environments... not a VAD
// only looks at first element of the smoothed buffer (see 
// smoothingTimeConstant setting below)
function startSimpleSilenceDetection(index, floatArray_time_domain) {
    /**
    *
    */
    function onSilence(index, elapsedTime, curr_value_time) {    
      console.log("*** [" + index + "] ***silence detected - value " + curr_value_time );
    }

    //var curr_value_time = (byteArray_time_domain[0] / 128) - 1.0; // values go from 0 to 255, with 128 being 0
    var curr_value_time = floatArray_time_domain[0] * 200.0;

    if (curr_value_time >       ssd_parms.amplitude   || 
        curr_value_time < (-1 * ssd_parms.amplitude)) 
    {
      starttime = Date.now();
    }
    var newtime = Date.now();
    var elapsedTime = newtime - starttime;
    if (elapsedTime > ssd_parms.duration) {
      onSilence(index, elapsedTime, curr_value_time);
      starttime = Date.now();
    } 
    //else {
    //  console.log("curr_value_time:" + curr_value_time );
    //}
}
