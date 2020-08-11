/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var ws = new WebSocket('wss://' + location.host + '/helloworld');
var videoInput;
var videoOutput;
var bokehCanvas;
var bokehCtx;
var imageCanvas;
var imageCtx;
var rawVideo;
var webRtcPeer;
var state = null;
var localStream = null;
var model = null;
var backgroundImage;

const I_CAN_START = 0;
const I_CAN_STOP = 1;
const I_AM_STARTING = 2;

window.onload = async function() {
	// console = new Console();
	console.log('Page loaded ...');
	videoInput = document.getElementById('videoInput');
	videoOutput = document.getElementById('videoOutput');
	bokehCanvas = document.getElementById('bokeh-canvas');
	bokehCtx = bokehCanvas.getContext('2d');
	imageCanvas = document.getElementById('image-canvas');
	imageCtx = imageCanvas.getContext('2d');
	rawVideo = document.getElementById('raw-video');
	backgroundImage = new Image();
	backgroundImage.src = "./img/space.jpg"; 
	await loadModel();
	setState(I_CAN_START);
}

window.onbeforeunload = function() {
	ws.close();
}

ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
	case 'startResponse':
		startResponse(parsedMessage);
		break;
	case 'error':
		if (state == I_AM_STARTING) {
			setState(I_CAN_START);
		}
		onError('Error message from server: ' + parsedMessage.message);
		break;
	case 'iceCandidate':
		webRtcPeer.addIceCandidate(parsedMessage.candidate)
		break;
	default:
		if (state == I_AM_STARTING) {
			setState(I_CAN_START);
		}
		onError('Unrecognized message', parsedMessage);
	}
}

async function loadModel() {
	model = await bodyPix.load({
		architecture: 'MobileNetV1',
		outputStride: 16,
		multiplier: 0.75,
		quantBytes: 2});
}

function start() {
	console.log('Starting video call ...')

	// Disable start button
	setState(I_AM_STARTING);
	showSpinner(videoInput, videoOutput);

	console.log('Creating WebRtcPeer and generating local sdp offer ...');

	var constraints = {
		audio: false,
		video: true
	}

	navigator.mediaDevices.getUserMedia(constraints)
	.then(function(stream){
		rawVideo.srcObject = stream;
		localStream = bokehCanvas.captureStream();
		var options = {
			localVideo: videoInput,
			remoteVideo: videoOutput,
			videoStream: localStream,
			onicecandidate : onIceCandidate,
		}
	  
		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error) {
			if(error) return onError(error);
			this.generateOffer(onOffer);
		});
	})
	.catch(error => { console.log('error') });

	rawVideo.onloadeddata = (event) => {
		bokehCanvas.width = rawVideo.width;
		bokehCanvas.height = rawVideo.height;
		imageCanvas.width = rawVideo.width;
		imageCanvas.height = rawVideo.height;
		changeBackground();
	};
}

function changeBackground() {
	async function changeBackgroundFrame() {
		imageCtx.drawImage(backgroundImage, 0, 0, rawVideo.width, rawVideo.height);
		var backgroundData = imageCtx.getImageData(0, 0, rawVideo.width, rawVideo.height).data;
		imageCtx.drawImage(rawVideo, 0, 0, rawVideo.width, rawVideo.height);
		var imageData = imageCtx.getImageData(0, 0, rawVideo.width, rawVideo.height);
		const segmentation = await model.segmentPerson(rawVideo);
		for(var y=0; y < rawVideo.height; y++) {
			for(var x=0; x < rawVideo.width; x++) {
				var pos = x + y*rawVideo.width;
				if(segmentation.data[pos] == 0) {
					imageData.data[pos * 4] = backgroundData[pos * 4];         //R
					imageData.data[pos * 4 + 1] = backgroundData[pos * 4 + 1]; //G
					imageData.data[pos * 4 + 2] = backgroundData[pos * 4 + 2]; //B
					imageData.data[pos * 4 + 3] = backgroundData[pos * 4 + 3]; //A
				}
			}
		}
		bokehCtx.putImageData(imageData, 0, 0);
		requestAnimationFrame(changeBackgroundFrame);
	}
	changeBackgroundFrame();
}

function onIceCandidate(candidate) {
	   console.log('Local candidate' + JSON.stringify(candidate));

	   var message = {
	      id : 'onIceCandidate',
	      candidate : candidate
	   };
	   sendMessage(message);
}

function onOffer(error, offerSdp) {
	if(error) return onError(error);

	console.info('Invoking SDP offer callback function ' + location.host);
	var message = {
		id : 'start',
		sdpOffer : offerSdp
	}
	sendMessage(message);
}

function onError(error) {
	console.error(error);
}

function startResponse(message) {
	setState(I_CAN_STOP);
	console.log('SDP answer received from server. Processing ...');
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function stop() {
	console.log('Stopping video call ...');
	setState(I_CAN_START);
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;

		var message = {
			id : 'stop'
		}
		sendMessage(message);
	}
	hideSpinner(videoInput, videoOutput);
	const stream = rawVideo.srcObject;
	stream.getTracks().forEach(function(track) {
		track.stop();
	});
	rawVideo.srcObject = null;
}

function setState(nextState) {
	switch (nextState) {
	case I_CAN_START:
		$('#start').attr('disabled', false);
		$('#start').attr('onclick', 'start()');
		$('#stop').attr('disabled', true);
		$('#stop').removeAttr('onclick');
		break;

	case I_CAN_STOP:
		$('#start').attr('disabled', true);
		$('#stop').attr('disabled', false);
		$('#stop').attr('onclick', 'stop()');
		break;

	case I_AM_STARTING:
		$('#start').attr('disabled', true);
		$('#start').removeAttr('onclick');
		$('#stop').attr('disabled', true);
		$('#stop').removeAttr('onclick');
		break;

	default:
		onError('Unknown state ' + nextState);
		return;
	}
	state = nextState;
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Sending message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});
