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
importScripts('wavEncoder.js'); 
importScripts('Vad.js'); 

var audioWorker;

self.onmessage = function(event) {
  var data = event.data;

  switch (data.command) {
    case 'start':
        if (data.vad_run) {
            audioWorker = new Audio.Vad(data);            
        } else {
            audioWorker = new Audio.Worker(data);
        }
      break;

    // no encoding while collecting audio for low powered devices
    case 'record':
      audioWorker.record(data);
      break;

    case 'finish':
      audioWorker.finish();
      break;
  }
};

// #############################################################################
var Audio = Audio || {};

// Superclass
Audio.Worker = function (data) {
    this.prompt_id = data.prompt_id;
    this.vad_run = data.vad_run;
    this.vad_parms = data.vad_parms;
    this.sampleRate = data.sampleRate;
    this.bitDepth = data.bitDepth;
    
    this.buffers = [];    
    this.dataViews = [];
    this.numSamples = 0;
}

Audio.Worker.prototype.record = function (data) {
    this.buffers.push(data.event_buffer); // array of buffer arrays
    this.numSamples += data.event_buffer.length;
}

Audio.Worker.prototype.finish = function () {
    self.postMessage({
        status: 'finished',
        obj : { 
            prompt_id: this.prompt_id,
            blob: this._convertBufferToAudioBlob(this.buffers),
            vad_run: false,
        }
    });

    this.buffers = [];
}

Audio.Worker.prototype._convertBufferToAudioBlob = function (bufferArray) {
    this._convertBufferToWavDataViewFormat(bufferArray);
    this._addWavHeaderToDataView();
       
    return new Blob(
        this.dataViews, 
        { type: 'audio/wav' });
}

Audio.Worker.prototype._convertBufferToWavDataViewFormat = function (bufferArray) {
    if (this.bitDepth === 16) { // testing FF on Chrome    
        this._convertAudioBuffersTo16bitDataView(bufferArray);
    } else { // 32-bit float - buffer unmodified
        this.dataViews = bufferArray;
    }
}

Audio.Worker.prototype._convertAudioBuffersTo16bitDataView = function (bufferArray) {
    while (bufferArray.length > 0) {
        var view = float2int16(bufferArray.shift());
        this.dataViews.push(view);
    }
}

Audio.Worker.prototype._addWavHeaderToDataView = function () {
    var header = createWavHeader(
        this.numSamples,
        this.bitDepth,
        this.sampleRate);
        
    this.dataViews.unshift(header);
}

// https://eli.thegreenplace.net/2013/10/22/classical-inheritance-in-javascript-es5
// #############################################################################
// subclass
Audio.Vad = function (data) {
    // Call constructor of superclass to initialize superclass-derived members.
    Audio.Worker.call(this, data);
    
    this.vad = new Vad(
        this.sampleRate,
        this.vad_parms);    
}

// Audio.Vad derives from Audio.Worker
Audio.Vad.prototype = Object.create(Audio.Worker.prototype);
Audio.Vad.prototype.constructor = Audio.Worker;

/*
// TODO VAD currently only works with 16-bit audio.
// So no matter what device you are using, if using vad,
// there will always be a conversion to 16-bit audio
 *
 * VAD can only process 16-bit audio, with sampling rates of 8/16/32/48kHz;
 * we are fudging a bit so can process 44.1kHz...
 * so split buffer up into smaller chunks that VAD can digest
 */ 
Audio.Vad.prototype.record = function (data) {
    this.buffers.push(data.event_buffer); // array of buffer arrays
    this.numSamples += data.event_buffer.length;

    let num_chunks = 4;
    let cutoff = Math.round(data.event_buffer.length / num_chunks);
    let buffers_index = this.buffers.length - 1;
    for (let i = 0; i < num_chunks; i++) {
        this._performVadOnChunk(data, i, cutoff, buffers_index);
    }
}

Audio.Vad.prototype._performVadOnChunk = function(
    data,
    i,
    cutoff,
    buffers_index)
{
    let chunk_index = i;
    let start = i * cutoff;
    let end = (i * cutoff) + cutoff;
    // slice extracts up to but not including end.
    let chunk = data.event_buffer.slice(start, end);
    var [buffer_chunk_int, chunk_energy] = floatTo16BitPCM(chunk);

    this.vad.calculateSilenceBoundaries(
        buffer_chunk_int,
        chunk_energy,
        buffers_index,
        chunk_index);
}

Audio.Vad.prototype.finish = function () {
    var speech_array, no_speech, no_trailing_silence, clipping, too_soft;
    
    [speech_array,
    no_speech,
    no_trailing_silence,
    clipping,
    too_soft] = this.vad.getSpeech(this.buffers);
        
    self.postMessage({
      status: 'finished',
      obj : { 
        prompt_id: this.prompt_id,
        blob: this._convertBufferToAudioBlob(speech_array),
        no_trailing_silence: no_trailing_silence,
        no_speech: no_speech,
        clipping: clipping,
        too_soft: too_soft,
        vad_run: true,
      }
    });

    this.buffers = [];
}