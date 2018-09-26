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

/**
* ### Contructor ##############################################
*/

function Uploader(parms,
                  alert_message)
{
    var self = this;

    this.maxMinutesSinceLastSubmission = parms.maxMinutesSinceLastSubmission;
    this.alert_message = alert_message;

    // TODO keep track of names of uploaded submissions... and allow user to display

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        const swUrl = '/voxforge_sw.js?uploadURL=' + encodeURIComponent(uploadURL);
        navigator.serviceWorker.register(swUrl)
        .then(
            function(reg) {
              console.log('ServiceWorker registration successful with scope: ', reg.scope);
            }, function(err) {
              console.warn('ServiceWorker registration failed: ', err);
              window.alert('Error: no SSL certificate installed on device - VoxForge uploads will fail silently');
            })
        .catch((err) => { console.log(err) });
      });
    }

    this.zip_worker = new Worker('/assets/static/scripts/ZipWorker.js');
    this.upload_worker = new Worker('/assets/static/scripts/UploadWorker.js');

    /**
    * if page reloaded kill background worker threads before page reload
    * to prevent zombie worker threads in FireFox
    */
    $( window ).unload(function() {
      self.zip_worker.terminate();
      self.upload_worker.terminate();
    });

    this.uploadedSubmissions = localforage.createInstance({
      name: "uploadedSubmissions"
    });
}

/**
* ### METHODS ##############################################
*/
/**
* set up worker handlers
*/
Uploader.prototype.init = function () {
    var self = this;

    /** 
    * process messages from service worker or web worker
    */
    function saveSubmissionsToList(filesUploaded) {
        for (let fileName of filesUploaded) {
            var jsonOnject = {};
            if (!Date.now) { // UTC timestamp in milliseconds;
                Date.now = function() { return new Date().getTime(); }
            }
            jsonOnject['timestamp'] = Date.now();
            
            self.uploadedSubmissions.setItem(fileName, jsonOnject)
            .catch(function(err) {
              console.error('save of uploaded submission name to localforage browser storage failed!', err);
            });
        }
    }

    /** 
    * process messages from service worker or web worker
    */
    function processWorkerEventMessage(event) {
        var returnObj = event.data;
        console.log(returnObj.workertype + " says: " + returnObj.status);

        var workertype;
        if (returnObj.workertype == "serviceworker") {
          workertype = self.alert_message.serviceworker;
        } else if (returnObj.workertype == "webworker") {
          workertype = self.alert_message.webworker;
        } else {
          workertype = self.alert_message.workernotfound;
        }

        function processMessage(m) {
            console.info(workertype + ": " + m);
            Promise.all(promise_list) // if user recording, wait for stop click before displaying alert
            .then(function() {
              window.alert(m);
            })
            .catch((err) => { console.log(err) });            
        }

        switch (returnObj.status) {
          case 'AllUploaded':
            var filesUploaded = returnObj.filesUploaded;
            
            saveSubmissionsToList(filesUploaded);
            
            var numberOfUploadedSubmissions = self.getNumberOfUploadedSubmissions() + filesUploaded.length;
            localStorage.setItem('numberOfUploadedSubmissions', numberOfUploadedSubmissions);


            var submissionText = (filesUploaded.length > 1 ? self.alert_message.submission_plural : self.alert_message.submission_singular);
            processMessage( filesUploaded.length + " " + 
                            submissionText + " " +
                            self.alert_message.uploaded_message  + "\n    " +
                            filesUploaded.join("\n    ")
            );

            break;

          case 'noneUploaded': // files saved to browser storage
            var filesNotUploaded =  returnObj.filesNotUploaded;
            var submissionText = (filesNotUploaded.length > 1 ? self.alert_message.submission_plural : self.alert_message.submission_singular);
            processMessage(  self.alert_message.localstorage_message + "\n" +
                             self.alert_message.browsercontains_message.trim() + " " + // remove newline
                             filesNotUploaded.length + " " + 
                             submissionText + ":\n    " + 
                             filesNotUploaded.join("\n    ")
            );
            break;

          // if there is an error with one submission (usually server side check - e.g.
          // file too big for server settings), then other submissions will upload, but
          // erroneous one will stay in browser storage.
          // TODO need a way for user to save these their o/s filesystem and upload
          // them to VoxForge server some other way.
          case 'partialUpload':
            var filesNotUploaded = returnObj.filesNotUploaded;
            var filesUploaded = returnObj.filesUploaded;

            var numberOfUploadedSubmissions = self.getNumberOfUploadedSubmissions() + filesUploaded.length;
            localStorage.setItem('numberOfUploadedSubmissions', numberOfUploadedSubmissions);

            var savedText = (filesNotUploaded.length > 1 ? self.alert_message.submission_plural : self.alert_message.submission_singular);
            var uploadedText = (filesNotUploaded.length > 1 ? self.alert_message.submission_plural : self.alert_message.submission_singular);

            var m = "Partial Upload:\n\n" +
                  filesUploaded.length + " " + 
                  savedText + " " +
                  self.alert_message.uploaded_message + 
                  "    " + filesUploaded.join("\n    ") +
                  "\n========================\n" +
                  self.alert_message.browsercontains_message.trim() + " " + // removes newline
                  filesNotUploaded.length + " " + 
                  uploadedText + ":\n" + 
                  "    " + filesNotUploaded.join("\n    ");
            if (returnObj.err) {
                m = m + "\n========================\n";
                m = m + "\n\nserver error message: " + returnObj.err;
            }
            processMessage(m);
            break;

          default:
            console.error('message from upload worker: transfer error: ' +
                          returnObj.status + " " + returnObj.message);
      } // switch
    } // processWorkerEventMessage

    // #########################################################################

    /** 
    * Handler for messages coming from web worker
    */
    self.upload_worker.onmessage = processWorkerEventMessage;

    /** 
    * Handler for messages coming from service worker
    */
    navigator.serviceWorker.addEventListener('message', processWorkerEventMessage);
}

/**
* collect all recorded audio into an array (audioArray) then calls function 
* that calls web worker that actually creates the zip file for download
* to VoxForge server
*/
Uploader.prototype.upload = function ( prompts,
                                       profile,
                                       debug,
                                       speechSubmissionAppVersion,
                                       allClips,
                                       language,
                                       debugChecked )
{
    var self = this;

    var clipIndex = 0;
    var audioArray = [];

    // ### inner functions #################################################

    /**
    * recursive function that loops over audio clips and asynchronously
    * loads them into audioArray.  This can cause some timing issues if
    * there are many audio files... therefore only reset user facing display
    * after all text and audio is sent to web worker for background processing
    *
    * uses xhr internally to collect read audio samples from shadow DOM
    */
    function processAudio() {
      return new Promise(function (resolve, reject) {
      
        function audioArrayLoop() {
          var clip = allClips[clipIndex];
          clip.style.display = 'None';
          var audioBlobUrl = clip.querySelector('audio').src;
          var prompt = clip.querySelector('prompt').innerText;
          var prompt_id = prompt.split(/(\s+)/).shift();
          prompts.prompts_recorded.push(prompt + '\n');

          // Ajax is asynchronous - once the request is sent script will 
          // continue executing without waiting for the response.
          var xhr = new XMLHttpRequest();
          // get blob from browser memory; 
          xhr.open('GET', audioBlobUrl, true);
          xhr.responseType = 'blob';
          xhr.onload = function(e) {
            if (this.status == 200) {
              var blob = this.response;
              // add current audio blob to zip file in browser memory
              audioArray.push ({
                  filename: prompt_id + '.wav', 
                  audioBlob: blob
              });
              clipIndex += 1;
              if (clipIndex < allClips.length) {
                audioArrayLoop();
              } else {
                // must be called here because ajax is asynchronous
                // Q1: why doesnt createZipFile get called many times as the call stack unrolls???
                // ... because status no longer status == 200???

                resolve(audioArray); // audioArray passed as parameter to next function in call chain
              }
            }
          };
          xhr.onerror = function() {
            reject("error processing audio from DOM");
          };
          xhr.send();
        } // audioArrayLoop

        audioArrayLoop();
      }); // Promise
      
    };// processAudio
    /**
    * call web worker to create zip file and upload to VoxForge server
    */
    function callWorker2createZipFile(audioArray) {
      if ( debugChecked ) {
          debug.setValues( 'prompts', prompts.getDebugValues() );
      } else {
          debug.clearValues('prompts');
      }
      
      return new Promise(function (resolve, reject) {

        // need to copy to blobs here (rather than in web worker) because if pass 
        // them as references to ZipWorker, they will be overwritten when page refreshes
        // and not be accessible within web worker
        self.zip_worker.postMessage({
          command: 'zipAndSave',

          speechSubmissionAppVersion: speechSubmissionAppVersion,
          temp_submission_name: profile.getTempSubmissionName(),
          short_submission_name: profile.getShortSubmissionName(),
          username: profile.getUserName(),
          language: language,
          suffix: profile.getSuffix(),

          readme_blob: new Blob(profile.toArray(), {type: "text/plain;charset=utf-8"}),
          prompts_blob: new Blob(prompts.toArray(), {type: "text/plain;charset=utf-8"}),
          license_blob: new Blob(profile.licensetoArray(), {type: "text/plain;charset=utf-8"}),
          profile_json_blob: new Blob([profile.toJsonString()], {type: "text/plain;charset=utf-8"}),
          prompts_json_blob: new Blob([prompts.toJsonString()], {type: "text/plain;charset=utf-8"}),
          audio: audioArray,
          debug_json_blob: new Blob([debug.toJsonString()], {type: "text/plain;charset=utf-8"}),
        });

        /**
        * Handler for messages coming from zip_worker web worker
        *
        * receives replies from worker thread and displays status accordingly
        * this is a worker callback inside the worker context
        */
        self.zip_worker.onmessage = function zipworkerDone(event) { 

          localStorage.setItem('timeOfLastSubmission', Date.now());
          localStorage.setItem('numberOfSubmissions', self.getNumberOfSubmissions() + 1);

          if (event.data.status === "savedInBrowserStorage") {
            console.info('webworker says: savedInBrowserStorage (zip file creation and save completed)');

            resolve('savedInBrowserStorage');

          } else {
            var m = 'webworker says: zip error: ' + event.data.status;
            console.error(m);
            reject(m);
          }
        };

      }); // Promise

    } // callWorker2createZipFile

    /** 
    * worker Processing - depending on browser support, use service worker and 
    * background sync to upload submission, if not available, use a web
    * worker that uploads in background; or perform asynchronous upload
    * if neither is supported.
    */
    function uploadZippedSubmission() {
      /** 
      * send message to service worker to start submission upload.
      *
      * supposed continue to try to upload even if no Internet, until connection
      * restablished, and if successful, remove uploaded submission from
      * browser storage, but this does not seem to work in Windows or Linux, 
      * only works with Android
      */
      function serviceWorkerUpload(swRegistration) {
        // for processing of return values from service worker, see 
        // service worker event above (i.e. navigator.serviceWorker.addEventListener... )
        swRegistration.sync.register('voxforgeSync')
        .then(
            function() {
              console.info('service worker background sync event called - submission will be uploaded shortly');
             }, function() {
              console.error('service worker background sync failed, will retry later');
            })
        .catch((err) => { console.log(err) });
      }

      /** 
      * send message to web worker to upload submission.  If fails, submission
      * stays in InnoDB until next time user makes submission, and then new
      * submission and any saved submissions will be uploaded, and removed
      * from browser storage after successful upload
      */
      function webWorkerUpload() {
          self.upload_worker.postMessage({
            command: 'upload',
            uploadURL: uploadURL,
          });
      }

      /** 
      * upload submission from main thread, asynchronously...
      * TODO is this even required???
      * might be useful to allow user to upload manually...
      */
      function asyncMainThreadUpload() {
        // TODO make sure not deadlock with service/web workers...
        // TODO: should try web workers first...
        // TODO localize in Read.md page...
        console.info('submission uploaded (in main thread) asynchronously to VoxForge server');

        processSavedSubmissions()
        .then(function(result) {
          console.info('async upload message: ' + result);
          window.alert( "the following submissions were successfully uploaded " +
                        "using async procedure: " + result );   
        })
        .catch(function(err) {
          console.error('async upload message: ' + err);
        });
      }

      // #######################################################################

      return new Promise(function (resolve, reject) {

          if (typeof navigator.serviceWorker !== 'undefined') { 
              navigator.serviceWorker.ready
              .then(function(swRegistration) { // service workers supported
                if (typeof swRegistration.sync !== 'undefined') { 
                  serviceWorkerUpload(swRegistration);  // background sync supported
                } else { 
                  console.warn('service worker does not support background sync... using web worker');
                  webWorkerUpload(); // background sync not supported
                }
              })
              .catch((err) => { console.log(err) });
          } else { // service workers not supported
            if( !! window.Worker ) { // web workers supported
                webWorkerUpload();
            } else { // should never get here...
                asyncMainThreadUpload();
            }
          }
          resolve("uploadZippedSubmission");

        }); // Promise

    } // uploadZippedSubmission

    // #######################################################################
    
    return new Promise(function (resolve, reject) {
      
        processAudio()
        .then(callWorker2createZipFile)
        .then(uploadZippedSubmission)
        .then(resolve) // resolve needs to be passed as a reference... therefore no parms
        .catch(function (err) {
          console.log(err.message);
          console.log(err.stack);
        });
        
    }); // Promise
}

/**
* localStorage stores everything as a string
*/
Uploader.prototype.getNumberOfUploadedSubmissions = function () {
  return parseInt( localStorage.getItem('numberOfUploadedSubmissions') || 0);
}

/**
* localStorage stores everything as a string
*/
Uploader.prototype.getNumberOfSubmissions = function () {
  return parseInt( localStorage.getItem('numberOfSubmissions') || 0);
}

/**
* 
*/
Uploader.prototype.minutesSinceLastSubmission = function () {
    var timeOfLastSubmission = localStorage.getItem('timeOfLastSubmission');
    if ( timeOfLastSubmission ) {
      var millis = Date.now() - timeOfLastSubmission;
      var mins = (millis / 1000) / 60;
      return Math.round(mins);
    } else {
      return 0;
    }

}
