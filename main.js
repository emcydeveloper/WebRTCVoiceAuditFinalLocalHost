"use strict";

const audio2 = document.querySelector("audio#audio2");
const callButton = document.querySelector("button#callButton");
const hangupButton = document.querySelector("button#hangupButton");
const codecSelector = document.querySelector("select#codec");
hangupButton.disabled = true;
callButton.onclick = call;
hangupButton.onclick = hangup;

let pc1;
let pc2;
let localStream;
let pc1ConnectionStats;
let pc2ConnectionStats;

let pc1FinalResult;
let pc2FinalResult;

let pc1LastResult;
let pc2LastResult;

let bytesSentBySender = document.getElementById("bytesSentBySender");
let bytesReceivedBySender = document.getElementById("bytesReceivedBySender");
let bytesSentByReceiver = document.getElementById("bytesSentByReceiver");
let bytesReceivedByReceiver = document.getElementById(
  "bytesReceivedByReceiver"
);
let packetsSentbySender = document.getElementById("packetsSentbySender");
let packetsReceivedBySender = document.getElementById(
  "packetsReceivedBySender"
);
let packetsSentByReceiver = document.getElementById("packetsSentByReceiver");
let packetsReceivedByReceiver = document.getElementById(
  "packetsReceivedByReceiver"
);
let receiverRoundTripTime = document.getElementById("receiverRoundTripTime");
let senderRoundTripTime = document.getElementById("senderRoundTripTime");

const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 0,
  voiceActivityDetection: false,
};

const audioLevels = [];
let audioLevelGraph;
let audioLevelSeries;

// Enabling opus DTX is an expert option without GUI.
// eslint-disable-next-line prefer-const
let useDtx = false;

// Disabling Opus FEC is an expert option without GUI.
// eslint-disable-next-line prefer-const
let useFec = true;

// We only show one way of doing this.
const codecPreferences = document.querySelector("#codecPreferences");
const supportsSetCodecPreferences =
  window.RTCRtpTransceiver &&
  "setCodecPreferences" in window.RTCRtpTransceiver.prototype;
if (supportsSetCodecPreferences) {
  codecSelector.style.display = "none";

  const { codecs } = RTCRtpSender.getCapabilities("audio");
  codecs.forEach((codec) => {
    if (["audio/CN", "audio/telephone-event"].includes(codec.mimeType)) {
      return;
    }
    const option = document.createElement("option");
    option.value = (
      codec.mimeType +
      " " +
      codec.clockRate +
      " " +
      (codec.sdpFmtpLine || "")
    ).trim();
    option.innerText = option.value;
    codecPreferences.appendChild(option);
  });
  codecPreferences.disabled = false;
} else {
  codecPreferences.style.display = "none";
}

// Change the ptime. For opus supported values are [10, 20, 40, 60].
// Expert option without GUI.
// eslint-disable-next-line no-unused-vars
async function setPtime(ptime) {
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  const desc = pc1.remoteDescription;
  if (desc.sdp.indexOf("a=ptime:") !== -1) {
    desc.sdp = desc.sdp.replace(/a=ptime:.*/, "a=ptime:" + ptime);
  } else {
    desc.sdp += "a=ptime:" + ptime + "\r\n";
  }
  await pc1.setRemoteDescription(desc);
}

function gotStream(stream) {
  hangupButton.disabled = false;
  console.log("Received local stream");
  localStream = stream;
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    console.log(`Using Audio device: ${audioTracks[0].label}`);
  }
  localStream.getTracks().forEach((track) => pc1.addTrack(track, localStream));
  console.log("Adding Local Stream to peer connection");

  if (supportsSetCodecPreferences) {
    const preferredCodec =
      codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== "") {
      const [mimeType, clockRate, sdpFmtpLine] =
        preferredCodec.value.split(" ");
      const { codecs } = RTCRtpSender.getCapabilities("audio");
      console.log(mimeType, clockRate, sdpFmtpLine);
      console.log(JSON.stringify(codecs, null, " "));
      const selectedCodecIndex = codecs.findIndex(
        (c) =>
          c.mimeType === mimeType &&
          c.clockRate === parseInt(clockRate, 10) &&
          c.sdpFmtpLine === sdpFmtpLine
      );
      const selectedCodec = codecs[selectedCodecIndex];
      codecs.splice(selectedCodecIndex, 1);
      codecs.unshift(selectedCodec);
      const transceiver = pc1
        .getTransceivers()
        .find(
          (t) => t.sender && t.sender.track === localStream.getAudioTracks()[0]
        );
      transceiver.setCodecPreferences(codecs);
      console.log("Preferred video codec", selectedCodec);
    }
  }

  pc1
    .createOffer(offerOptions)
    .then(gotDescription1, onCreateSessionDescriptionError);

  bitrateSeries = new TimelineDataSeries();
  bitrateGraph = new TimelineGraphView("bitrateGraph", "bitrateCanvas");
  bitrateGraph.updateEndDate();

  targetBitrateSeries = new TimelineDataSeries();
  targetBitrateSeries.setColor("blue");

  headerrateSeries = new TimelineDataSeries();
  headerrateSeries.setColor("green");

  packetSeries = new TimelineDataSeries();
  packetGraph = new TimelineGraphView("packetGraph", "packetCanvas");
  packetGraph.updateEndDate();

  audioLevelSeries = new TimelineDataSeries();
  audioLevelGraph = new TimelineGraphView(
    "audioLevelGraph",
    "audioLevelCanvas"
  );
  audioLevelGraph.updateEndDate();
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

function call() {
  callButton.disabled = true;
  codecSelector.disabled = true;

  document.getElementById("pc1AllResults").innerHTML = null;
  document.getElementById("pc2AllResults").innerHTML = null;
  
  console.log("Starting call");

  const servers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      {
        url: "turn:numb.viagenie.ca",
        credential: "muazkh",
        username: "webrtc@live.com",
      },
      {
        url: "turn:192.158.29.39:3478?transport=udp",
        credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
        username: "28224511:1379330808",
      },
      {
        url: "turn:192.158.29.39:3478?transport=tcp",
        credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
        username: "28224511:1379330808",
      },
      {
        url: "turn:turn.bistri.com:80",
        credential: "homeo",
        username: "homeo",
      },
      {
        url: "turn:turn.anyfirewall.com:443?transport=tcp",
        credential: "webrtc",
        username: "webrtc",
      },
    ],
    // iceTransportPolicy: "relay",
  };

  pc1 = new RTCPeerConnection(servers);
  pc2 = new RTCPeerConnection(servers);

  console.log("Created local peer connection object pc1");
  console.log("Created remote peer connection object pc2");

  pc1.onconnectionstatechange = (ev) => {
    document.getElementById("connection-state").innerHTML = `<b> Connection State: </b>  PC1 -- Status - ${ev}`
    switch (pc1.connectionState) {
      case "new":
        console.log(
          "PC1 -- Status - New and trying to establish connection..."
        );
        break;
      case "checking":
        console.log("PC1 -- Status - Checking and Connecting...");
        break;
      case "connecting":
        console.log("PC1 -- Status - Connecting... Please wait..");
        break;
      case "connected":
        console.log("PC1 -- Status - Connected and Online...");
        break;
      case "disconnected":
        console.log("PC1 -- Status - Disconnecting and may try to connect...");
        break;
      case "closed":
        console.log("PC1 -- Status - Closed and Offline...");
        break;
      case "failed":
        console.log("PC1 -- Status - Failed and Re-trying...");
        break;
      default:
        // stat = setOnlineStatus("Unknown");
        console.log("PC1 -- Status - Unknown and Unknown...");
        break;
    }
    if (
      pc1.connectionState == "connected" &&
      pc2.connectionState == "connected"
    ) {
      document.getElementById("connection-state").innerHTML = `<b> Connection State: </b> Caller and Receiver connected successfully.`
      console.info(
        "Caller and Receiver connected successfully. Displaying status..."
      );
      getStats();
    }
  };

  pc2.onconnectionstatechange = (ev) => {
    document.getElementById("connection-state").innerHTML = `<b> Connection State: </b> PC1 -- Status - ${ev}`
    switch (pc2.connectionState) {
      case "new":
        // stat = setOnlineStatus("Connecting...");
        console.log(
          "PC2 -- Status - New and trying to establish connection..."
        );
        break;
      case "checking":
        // stat = setOnlineStatus("Connecting...");
        console.log("PC2 -- Status - Checking and Connecting...");
        break;
      case "connecting":
        console.log("PC2 -- Status - Connecting... Please wait..");
        break;
      case "connected":
        // stat = setOnlineStatus("Online");
        console.log("PC2 -- Status - Connected and Online...");

        break;
      case "disconnected":
        // stat = setOnlineStatus("Disconnecting...");
        console.log("PC2 -- Status - Disconnected and may try to connect...");
        break;
      case "closed":
        // stat = setOnlineStatus("Offline");
        console.log("PC2 -- Status - Closed and Offline...");
        break;
      case "failed":
        // stat = setOnlineStatus("Error");
        console.log("PC2 -- Status - Failed and Re-trying...");
        break;
      default:
        // stat = setOnlineStatus("Unknown");
        console.log("PC2 -- Status - Unknown and Unknown...");
        break;
    }
    if (
      pc1.connectionState == "connected" &&
      pc2.connectionState == "connected"
    ) {
      document.getElementById("connection-state").innerHTML = `<b> Connection State: </b> Caller and Receiver connected successfully.`
      console.info(
        "Caller and Receiver connected successfully. Displaying status..."
      );
      getStats();
    }
  };

  pc1.onicecandidate = (e) => onIceCandidate(pc1, e);

  pc2.onicecandidate = (e) => onIceCandidate(pc2, e);
  pc2.ontrack = gotRemoteStream;
  console.log("Requesting local stream");
  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: false,
    })
    .then(gotStream)
    .catch((e) => {
      console.error(`getUserMedia() error: ${e.name}`);
    });
}

function gotDescription1(desc) {
  console.log(`Offer from pc1\n${desc.sdp}`);

  pc1.setLocalDescription(desc).then(() => {
    if (!supportsSetCodecPreferences) {
      desc.sdp = forceChosenAudioCodec(desc.sdp);
    }
    pc2.setRemoteDescription(desc).then(() => {
      return pc2
        .createAnswer()
        .then(gotDescription2, onCreateSessionDescriptionError);
    }, onSetSessionDescriptionError);
  }, onSetSessionDescriptionError);
}

function gotDescription2(desc) {
  console.log(`Answer from pc2\n${desc.sdp}`);

  pc2.setLocalDescription(desc).then(() => {
    if (!supportsSetCodecPreferences) {
      desc.sdp = forceChosenAudioCodec(desc.sdp);
    }
    if (useDtx) {
      desc.sdp = desc.sdp.replace("useinbandfec=1", "useinbandfec=1;usedtx=1");
    }
    if (!useFec) {
      desc.sdp = desc.sdp.replace("useinbandfec=1", "useinbandfec=0");
    }
    pc1.setRemoteDescription(desc).then(() => {}, onSetSessionDescriptionError);
  }, onSetSessionDescriptionError);
}

function hangup() {
  console.log("Ending call");



  bytesSentBySender.innerHTML = 0;
  bytesReceivedByReceiver.innerHTML = 0;

  packetsSentbySender.innerHTML = 0;
  packetsReceivedByReceiver.innerHTML = 0;

  senderRoundTripTime.innerHTML = 0;
  document.getElementById(
    "pc1AllResults"
  ).innerHTML += `\n <hr> <b> <h1> Sender data - </h1></b>`;
  pc1FinalResult.forEach((report) => {
    if (report.type == "candidate-pair" || report.type == "outbound-rtp") {
      document.getElementById(
        "pc1AllResults"
      ).innerHTML += `\n <hr> <b> <h3> ${report.type}: Results - </h3> </b> <br>`;

      Object.keys(report).forEach((key) => {
        document.getElementById(
          "pc1AllResults"
        ).innerHTML += `${key}: ${report[key]} \n <br>`;
        bytesSentBySender.innerHTML = report["bytesSent"];
        packetsSentbySender.innerHTML = report["packetsSent"];
        senderRoundTripTime.innerHTML = report["totalRoundTripTime"];
        //receiverRoundTripTime

        
      });
    }
  });

  document.getElementById(
    "pc2AllResults"
  ).innerHTML += `\n <hr> <b> <h1> Receiver data - </h1></b>`;
  pc2FinalResult.forEach((report) => {
    if (report.type == "candidate-pair" || report.type == "inbound-rtp") {
      document.getElementById(
        "pc2AllResults"
      ).innerHTML += `\n <hr> <b> <h3> ${report.type}: Results - </h3> </b> <br>`;

      Object.keys(report).forEach((key) => {
        document.getElementById(
          "pc2AllResults"
        ).innerHTML += `${key}: ${report[key]} \n <br>`;
        bytesReceivedByReceiver.innerHTML = report["bytesReceived"];
        packetsReceivedByReceiver.innerHTML = report["packetsReceived"];
        // receiverRoundTripTime.innerHTML = report["bytesReceived"];
      });

      // report.map((dt) => {console.log(dt)});
      //document.getElementById("pc1AllResults").innerHTML += `\n <hr> <b> ${report.type} - </b>  ${JSON.stringify(report)}`;
    }
  });

  /*
  let pc1SentBytesFinal;
  // let pc1ReceivedBytesFinal;
  let pc1SentPacketsFinal;
  // let pc1ReceivedPacketsFinal;
  let pc1RoundTripTimeFinal;

  // let pc2SentBytesFinal;
  let pc2ReceivedBytesFinal;
  // let pc2SentPacketsFinal;
  let pc2ReceivedPacketsFinal;
  let pc2RoundTripTimeFinal;

  pc1SentBytesFinal = pc1FinalResult.bytesSent;
  // pc1ReceivedBytesFinal = pc1FinalResult.bytesReceived;
  pc1SentPacketsFinal = pc1FinalResult.packetsSent;
  // pc1ReceivedPacketsFinal = pc1FinalResult.packetsReceived;
  pc1RoundTripTimeFinal = pc1FinalResult.totalRoundTripTime;

  // pc2SentBytesFinal = pc2FinalResult.bytesSent;
  pc2ReceivedBytesFinal = pc2FinalResult.bytesReceived;
  // pc2SentPacketsFinal = pc2FinalResult.packetsSent;
  pc2ReceivedPacketsFinal = pc2FinalResult.packetsReceived;
  pc2RoundTripTimeFinal = pc2FinalResult.totalRoundTripTime;

  bytesSentBySender.innerHTML = pc1SentBytesFinal;
  bytesReceivedByReceiver.innerHTML = pc2ReceivedBytesFinal;
  console.log("Bytes - ", pc1SentBytesFinal);
  console.log("Bytes - ", pc2ReceivedBytesFinal);

  // bytesSentByReceiver.innerHTML = pc2SentBytesFinal;
  // bytesReceivedBySender.innerHTML = pc1ReceivedBytesFinal;
  // console.log("Bytes Sent By Receiver - ", pc2SentBytesFinal);
  // console.log("Bytes Received By Sender - ", pc1ReceivedBytesFinal);

  packetsSentbySender.innerHTML = pc1SentPacketsFinal;
  packetsReceivedByReceiver.innerHTML = pc2ReceivedPacketsFinal;
  console.log("Packets - ", pc1SentPacketsFinal);
  console.log("Packets - ", pc2ReceivedPacketsFinal);

  // packetsSentByReceiver.innerHTML = pc2SentPacketsFinal;
  // packetsReceivedBySender.innerHTML = pc1ReceivedPacketsFinal;
  // console.log("Packets Sent By Receiver - ", pc2SentPacketsFinal);
  // console.log("Packets Received By Sender - ", pc1ReceivedPacketsFinal);

  senderRoundTripTime.innerHTML = `Sender Round Trip Time - ${pc1RoundTripTimeFinal}`;
  // receiverRoundTripTime.innerHTML = `Receiver Round Trip Time - ${pc2RoundTripTimeFinal}` ;

  console.log("Sender Round Trip Time - ", pc1RoundTripTimeFinal);
  // console.log("Receiver Round Trip Time - ", pc2RoundTripTimeFinal);*/

  localStream.getTracks().forEach((track) => track.stop());
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
  codecSelector.disabled = false;

}

function gotRemoteStream(e) {
  if (audio2.srcObject !== e.streams[0]) {
    audio2.srcObject = e.streams[0];
    console.log("Received remote stream");
  }
}

function getOtherPc(pc) {
  return pc === pc1 ? pc2 : pc1;
}

function getName(pc) {
  return pc === pc1 ? "pc1" : "pc2";
}

function onIceCandidate(pc, event) {
  getOtherPc(pc)
    .addIceCandidate(event.candidate)
    .then(
      () => onAddIceCandidateSuccess(pc),
      (err) => onAddIceCandidateError(pc, err)
    );
  console.log(
    `${getName(pc)} ICE candidate:\n${
      event.candidate ? event.candidate.candidate : "(null)"
    }`
  );
}

function onAddIceCandidateSuccess() {
  console.log("AddIceCandidate success.");
}

function onAddIceCandidateError(error) {
  console.log(`Failed to add ICE Candidate: ${error.toString()}`);
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

function forceChosenAudioCodec(sdp) {
  return maybePreferCodec(sdp, "audio", "send", codecSelector.value);
}

// Copied from AppRTC's sdputils.js:

// Sets |codec| as the default |type| codec if it's present.
// The format of |codec| is 'NAME/RATE', e.g. 'opus/48000'.
function maybePreferCodec(sdp, type, dir, codec) {
  const str = `${type} ${dir} codec`;
  if (codec === "") {
    console.log(`No preference on ${str}.`);
    return sdp;
  }

  console.log(`Prefer ${str}: ${codec}`);

  const sdpLines = sdp.split("\r\n");

  // Search for m line.
  const mLineIndex = findLine(sdpLines, "m=", type);
  if (mLineIndex === null) {
    return sdp;
  }

  // If the codec is available, set it as the default in m line.
  const codecIndex = findLine(sdpLines, "a=rtpmap", codec);
  console.log("codecIndex", codecIndex);
  if (codecIndex) {
    const payload = getCodecPayloadType(sdpLines[codecIndex]);
    if (payload) {
      sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], payload);
    }
  }

  sdp = sdpLines.join("\r\n");
  return sdp;
}

// Find the line in sdpLines that starts with |prefix|, and, if specified,
// contains |substr| (case-insensitive search).
function findLine(sdpLines, prefix, substr) {
  return findLineInRange(sdpLines, 0, -1, prefix, substr);
}

// Find the line in sdpLines[startLine...endLine - 1] that starts with |prefix|
// and, if specified, contains |substr| (case-insensitive search).
function findLineInRange(sdpLines, startLine, endLine, prefix, substr) {
  const realEndLine = endLine !== -1 ? endLine : sdpLines.length;
  for (let i = startLine; i < realEndLine; ++i) {
    if (sdpLines[i].indexOf(prefix) === 0) {
      if (
        !substr ||
        sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1
      ) {
        return i;
      }
    }
  }
  return null;
}

// Gets the codec payload type from an a=rtpmap:X line.
function getCodecPayloadType(sdpLine) {
  const pattern = new RegExp("a=rtpmap:(\\d+) \\w+\\/\\d+");
  const result = sdpLine.match(pattern);
  return result && result.length === 2 ? result[1] : null;
}

// Returns a new m= line with the specified codec as the first one.
function setDefaultCodec(mLine, payload) {
  const elements = mLine.split(" ");

  // Just copy the first three parameters; codec order starts on fourth.
  const newLine = elements.slice(0, 3);

  // Put target payload first and copy in the rest.
  newLine.push(payload);
  for (let i = 3; i < elements.length; i++) {
    if (elements[i] !== payload) {
      newLine.push(elements[i]);
    }
  }
  return newLine.join(" ");
}

function getStats() {
  window.setInterval(() => {
    if (!pc1) {
      return;
    }

    const sender = pc1.getSenders()[0];
    if (!sender) {
      return;
    }
    sender.getStats().then((res) => {
      pc1FinalResult = res;
      res.forEach((report) => {
        let pc1SentBytes;
        // let pc1ReceivedBytes;
        let pc1SentPackets;
        // let pc1ReceivedPackets;
        let pc1RoundTripTime;
        // console.log("SENDER",report)
        // if (report.type === "outbound-rtp") {
        if (report.type === "candidate-pair") {
          if (report.isRemote) {
            return;
          }
          // pc1FinalResult = report;

          const now = report.timestamp;
          // const now =  new Date().getHours() + ":" + new Date().getMinutes() + ":" + new Date().getSeconds();
          pc1SentBytes = report.bytesSent;
          // pc1ReceivedBytes = report.bytesReceived;
          pc1SentPackets = report.packetsSent;
          // pc1ReceivedPackets = report.packetsReceived;
          pc1RoundTripTime = report.totalRoundTripTime;

          if (pc1LastResult && pc1LastResult.has(report.id)) {
            const deltaT =
              (now - pc1LastResult.get(report.id).timestamp) / 1000;
            // calculate bitrate

            const sentBitRate =
              (8 * (pc1SentBytes - pc1LastResult.get(report.id).bytesSent)) /
              deltaT;
            // const receivedBitRate =
            //   (8 *
            //     (pc1ReceivedBytes -
            //       pc1LastResult.get(report.id).bytesReceived)) /
            //   deltaT;
            const sentPacketrRate =
              (8 *
                (pc1SentPackets - pc1LastResult.get(report.id).packetsSent)) /
              deltaT;
            // const receivedPacketrRate =
            //   (8 *
            //     (pc1ReceivedPackets -
            //       pc1LastResult.get(report.id).packetsReceived)) /
            //   deltaT;
            const roundTripRate =
              (8 *
                (pc1RoundTripTime -
                  pc1LastResult.get(report.id).totalRoundTripTime)) /
              deltaT;

            console.log("*********SENDER*********");

            bytesSentBySender.innerHTML = sentBitRate.toFixed(2);
            // bytesReceivedBySender.innerHTML = receivedBitRate;
            packetsSentbySender.innerHTML = sentPacketrRate.toFixed(2);
            // packetsReceivedBySender.innerHTML = receivedPacketrRate;
            senderRoundTripTime.innerHTML = `Sender Total Round Trip Time : ${roundTripRate.toFixed(2)}`;

            console.log(`Time: -  ${now} Total Bytes Sent : ${sentBitRate}`);
            // console.log(
            //   `Time: -  ${now} Total Bytes Received : ${receivedBitRate}`
            // );
            console.log(`Time: -  ${now} Packet Sent : ${sentPacketrRate}`);
            // console.log(
            //   `Time: -  ${now} Packet Received : ${receivedPacketrRate}`
            // );
            console.log(
              `Time: -  ${now} Total Round Trip Time : ${roundTripRate}`
            );
          }
        }
      });
      pc1LastResult = res;
    });

    const receiver = pc2.getReceivers()[0];
    if (!receiver) {
      return;
    }
    receiver.getStats().then((res) => {
      pc2FinalResult = res;
      res.forEach((report) => {
        // let pc2SentBytes;
        let pc2ReceivedBytes;
        // let pc2SentPackets;
        let pc2ReceivedPackets;
        let pc2RoundTripTime;
        // console.log("RECEIVER",report)
        // if (report.type === "inbound-rtp") {
        if (report.type === "candidate-pair") {
          if (report.isRemote) {
            return;
          }

          // pc2FinalResult = report;
          const now = report.timestamp;

          // pc2SentBytes = report.bytesSent;
          pc2ReceivedBytes = report.bytesReceived;
          // pc2SentPackets = report.packetsSent;
          pc2ReceivedPackets = report.packetsReceived;
          pc2RoundTripTime = report.totalRoundTripTime;

          if (pc2LastResult && pc2LastResult.has(report.id)) {
            const deltaT =
              (now - pc2LastResult.get(report.id).timestamp) / 1000;
            // calculate bitrate

            // const sentBitRate =
            //   (8 * (pc2SentBytes - pc2LastResult.get(report.id).bytesSent)) /
            //   deltaT;
            const receivedBitRate =
              (8 *
                (pc2ReceivedBytes -
                  pc2LastResult.get(report.id).bytesReceived)) /
              deltaT;
            // const sentPacketrRate =
            //   (8 *
            //     (pc2SentPackets - pc2LastResult.get(report.id).packetsSent)) /
            //   deltaT;
            const receivedPacketrRate =
              (8 *
                (pc2ReceivedPackets -
                  pc2LastResult.get(report.id).packetsReceived)) /
              deltaT;
            const roundTripRate =
              (8 *
                (pc2RoundTripTime -
                  pc2LastResult.get(report.id).totalRoundTripTime)) /
              deltaT;

            console.log("*********RECEIVER*********");

            // bytesSentByReceiver.innerHTML = sentBitRate;
            bytesReceivedByReceiver.innerHTML = receivedBitRate.toFixed(2);
            // packetsSentByReceiver.innerHTML = sentPacketrRate;
            packetsReceivedByReceiver.innerHTML = receivedPacketrRate.toFixed(2);
            // receiverRoundTripTime.innerHTML = `Receiver Total Round Trip Time : ${roundTripRate}`;

            // console.log(`Time: -  ${now} Total Bytes Sent : ${sentBitRate}`);
            console.log(
              `Time: -  ${now} Total Bytes Received : ${receivedBitRate}`
            );
            // console.log(`Time: -  ${now} Packet Sent : ${sentPacketrRate}`);
            console.log(
              `Time: -  ${now} Packet Received : ${receivedPacketrRate}`
            );
            console.log(
              `Time: -  ${now} Total Round Trip Time : ${roundTripRate}`
            );
          }
        }
      });

      pc2LastResult = res;
    });
  }, 1000);
}

if (
  window.RTCRtpReceiver &&
  "getSynchronizationSources" in window.RTCRtpReceiver.prototype
) {
  let lastTime;
  const getAudioLevel = (timestamp) => {
    window.requestAnimationFrame(getAudioLevel);
    if (!pc2) {
      return;
    }
    const receiver = pc2.getReceivers().find((r) => r.track.kind === "audio");
    if (!receiver) {
      return;
    }
    const sources = receiver.getSynchronizationSources();
    sources.forEach((source) => {
      audioLevels.push(source.audioLevel);
    });
    if (!lastTime) {
      lastTime = timestamp;
    } else if (timestamp - lastTime > 500 && audioLevels.length > 0) {
      // Update graph every 500ms.
      const maxAudioLevel = Math.max.apply(null, audioLevels);
      //   audioLevelSeries.addPoint(Date.now(), maxAudioLevel);
      //   audioLevelGraph.setDataSeries([audioLevelSeries]);
      //   audioLevelGraph.updateEndDate();
      audioLevels.length = 0;
      lastTime = timestamp;
    }
  };
  window.requestAnimationFrame(getAudioLevel);
}
