const options = {
    serviceUrl: 'https://meet.theater.digital/http-bind',
    hosts: {

        domain: 'meet.theater.digital',
        muc: 'conference.meet.theater.digital'
    }
};
const confOptions = {
    openBridgeChannel: true
};

const videoSize = {
    width: 624,
    height: 351
};

let connection = null;
let isJoined = false;
let room = null;

// zu mappende namen.
let remoteMappingName = [
    'speaker1', 'speaker2', 'speaker3',
    'speaker4', 'speaker5', 'speaker6',
    'speaker7', 'speaker8', 'speaker9'
];
// track mapping participant id -> position
let trackMapping = {};
// alle verfügbaren tracks mit participant id -> {audio: track, video: track}
let tracks = {};
// name -> id
let nameMapping = {};

/**
 *
 *              MIDI SECTION
 */
let midi, data;
// start talking to MIDI controller
if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess({
        sysex: false
    }).then(onMIDISuccess);
} else {
    console.warn("No MIDI support in your browser")
}

// on success
function onMIDISuccess(midiData) {
    // this is all our MIDI data
    midi = midiData;
    let allInputs = midi.inputs.values();
    // loop over all available inputs and listen for any MIDI input
    for (let input = allInputs.next(); input && !input.done; input = allInputs.next()) {
        // when a MIDI value is received call the onMIDIMessage function
        input.value.onmidimessage = (messageData ) => {
            if(messageData.date[0] != 176) return;
            midiSetLevel(messageData.data[1], Math.round(messageData[2]/127))
            console.log(messageData.data);
        };
    }
}

/**
 *
 *             END MIDI SECTION
 *
 */

/**
 * Selects all shown participants to receive high quality video. Otherwise Jitsi will only show thumbnail size video to the Streamer
 */
function selectParticipants() {
    let part = [];
    for(let i in trackMapping) {
        if(trackMapping.hasOwnProperty(i)) {
            part.push(i)
        }
    }
    room.selectParticipants(part);
}
/**
 *
 * @param participant
 * @param track
 * @param type
 */
function setRemoteTrack(participant, track, type) {
    if (trackMapping[participant] == null)
        return;
    console.log(`attaching ${type} track from ${participant}`);
    if (type === 'video') {
        let elemID = `.video-${trackMapping[participant]} video`;
        track.attach($(elemID)[0]);
        tracks[participant].video = track;
    } else {
        let elemID = `.video-${trackMapping[participant]} audio`;
        track.attach($(elemID)[0]);
        tracks[participant].audio = track;
    }
}

/**
 * Handles remote tracks
 * @param track JitsiTrack object
 */
function onRemoteTrack(track) {
    if (track.isLocal()) {
        return;
    }
    const participant = track.getParticipantId();
    if(!tracks[participant]) {
        tracks[participant] = {};
    }
    tracks[participant][track.getType()] = track;
    setRemoteTrack(participant, track, track.getType());
}

/**
 * Event wenn ein Mediastream entfernt wurde.
 * Räumt die Track tracker objekte auf und entfernt - wenn vorhanden - die entsprechende zuordnung zum media element
 * @param track
 */
function onRemoteTrackRemove(track) {
    const participant = track.getParticipantId();
    const type = track.getType();
    if(trackMapping[participant] != null && tracks[participant][type]) {
        console.log(`detaching ${type} track from ${participant}`);
        tracks[participant][type].detach($(`.video-${trackMapping[participant]} ${type}`)[0]);
    }
    delete tracks[participant][type];
    if(!tracks[participant].audio && !tracks[participant].video) {
        delete tracks[participant]
    }
}

/**
 * That function is executed when the conference is joined
 */
function onConferenceJoined() {
    console.log('conference joined!');
    isJoined = true;
}

/**
 *
 * @param id
 * @param user
 */
function onUserJoin(id, user) {
    console.log(`user join - ${user.getDisplayName()}`);
    nameMapping[user.getDisplayName()] = id;
    let position = remoteMappingName.indexOf(user.getDisplayName());
    if(position >= 0) {
        console.log("user found");
        trackMapping[id] = position;
        selectParticipants();
    }
}

/**
 * Event für Namensänderungen, ordnet den user korrekt an.
 * @param participant
 * @param displayName
 */
function onNameChange(participant, displayName) {

    nameMapping[displayName] = participant;
    // detach this user from current position
    detachUser(participant);
    let position = remoteMappingName.indexOf(displayName);

    if(position >= 0 && tracks[participant]) {
        // detach user in the new position
        for(let i in trackMapping) {
            if(trackMapping[i] === position) {
                detachUser(i);
                break;
            }
        }
        attachUser(participant, position)
    }
    selectParticipants()
}

/**
 * Event wenn ein User den Raum verlässt
 * Entfernt die Verbindung der Tracks mit den Mediaelementen wenn vorhanden und räumt die Track tracker objekte auf.
 * @param id
 */
function onUserLeft(id) {
    console.log('user left');
    detachUser(id);
    delete tracks[id];
    for(let i in nameMapping) {
        if(nameMapping[i] === id) {
            delete nameMapping[i];
            break;
        }
    }
    selectParticipants()
}

function detachUser(id) {
    if (trackMapping[id] != null) {
        console.log("detaching user " + id);
        if(tracks[id] && tracks[id].video) {
            tracks[id].video.detach($(`.video-${trackMapping[id]} video`)[0]);
        }
        if(tracks[id] && tracks[id].audio) {
            tracks[id].audio.detach($(`.video-${trackMapping[id]} audio`)[0]);
        }
        delete trackMapping[id]
    }
}
function attachUser(id, position) {
    if (trackMapping[id] == null && tracks[id] != null) {
        console.log(`attaching user ${id} to ${position}`);
        trackMapping[id] = position;
        if (tracks[id].video) {
            let elemID = `.video-${position} video`;
            tracks[id].video.attach($(elemID)[0]);
        }
        if(tracks[id].audio) {
            let elemID = `.video-${position} audio`;
            tracks[id].audio.attach($(elemID)[0]);
        }
    }
}

/**
 * Enables the connect button, so that we can join a room
 */
function onConnectionSuccess() {
    $('#room-name-button').prop('disabled', false);
}

/**
 * Resizes the video element according to maximum available width and height. Respects input aspect ratio.
 */
function onVideoResize(event) {
    const video = $(event.target)[0];
    const width = video.videoWidth;
    const height = video.videoHeight;
    const aspectRatio = width/height;
    console.log(`${aspectRatio} is the aspect ratio`);

    let targetWidth = videoSize.width;
    let targetHeight = videoSize.height
    ;
    if(width > videoSize.width) {
        targetHeight *= videoSize.width / width
    }
    if(height > targetHeight) {
        targetWidth *= targetHeight / height
    }
    video.width = targetWidth;
    video.height = targetHeight;
}

/**
 * This function is called when we disconnect. It removes the Listeners.
 */
function disconnect() {
    console.log('disconnect!');
    connection.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
        onConnectionSuccess);
    connection.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
        disconnect);
}

/**
 * Connects the interface to a conference room, sets up the listeners..
 */
function connect() {
    const roomName = $('#room-name').val();

    room = connection.initJitsiConference(roomName, confOptions);
    room.setDisplayName("Streamer");
    room.on(JitsiMeetJS.events.conference.TRACK_ADDED, onRemoteTrack);
    room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, onRemoteTrackRemove);
    room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, onConferenceJoined);
    room.on(JitsiMeetJS.events.conference.USER_JOINED, onUserJoin);
    room.on(JitsiMeetJS.events.conference.USER_LEFT, onUserLeft);
    room.on(JitsiMeetJS.events.conference.DISPLAY_NAME_CHANGED, onNameChange);
    room.join($('#room-password').val());
    $('#room-selector').hide();
    $('#room').show();

    let video = $('.video');
    for(let i = 0; i<video.length; i++) {
        if(!video.hasOwnProperty(i)) {
            continue;
        }
        $(video[i]).find('input')[0].value = remoteMappingName[i];
        $('.volume-' + i + ' .name').text(remoteMappingName[i]);
        $('.volume-' + i + ' input').val(0.7);
        $(video[i]).find('video').on('resize', onVideoResize).width(videoSize.width).height(videoSize.height);
    }
}

/**
 * Disconnects everything
 */
function unload() {
    room.leave();
    connection.disconnect();
}

/**
 * Sets the Outputlevel of an audio source
 * @param id
 * @param level
 */
function setLevel(id, level) {
    let track = $(`.video-${id} audio`)[0];
    let volumeLabel = $('.volume-' + id + ' .volume');
    track.volume = level;
    volumeLabel.text(Math.round(level*100) + "%")
}

/**
 * Sets the volume level coming from MIDI input, also sets correct fader position to audio slider
 * @param id
 * @param level
 */
function midiSetLevel(id, level) {
    if(id >= remoteMappingName.length) {
        return;
    }
    setLevel(id, level);
    $('.volume-' + id + ' input').val(level);
}

/**
 * Sets the name of a position
 * @param position
 * @param name
 */
function setName(position, name) {
    console.log(`setting name of ${position} to ${name}`);
    remoteMappingName[position] = name;
    $('.volume-' + position + ' .name').text(name);
    for(let i in trackMapping) {
        if(trackMapping[i] === position) {
            detachUser(i);
            break;
        }
    }
    if(nameMapping[name] != null) {
        attachUser(nameMapping[name], position)
    }
    selectParticipants()
}
/**
 * Sets the output to the selected outputsource
 * @param selected
 */
function changeAudioOutput(selected) { // eslint-disable-line no-unused-vars
    JitsiMeetJS.mediaDevices.setAudioOutputDevice(selected.value);
}

$(window).bind('beforeunload', unload);
$(window).bind('unload', unload);

JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);

JitsiMeetJS.init({});

connection = new JitsiMeetJS.JitsiConnection(null, null, options);

connection.addEventListener(
    JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
    onConnectionSuccess);
connection.addEventListener(
    JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
    disconnect);

connection.connect();

if (JitsiMeetJS.mediaDevices.isDeviceChangeAvailable('output')) {
    JitsiMeetJS.mediaDevices.enumerateDevices(devices => {
        const audioOutputDevices
            = devices.filter(d => d.kind === 'audiooutput');

        if (audioOutputDevices.length > 1) {
            $('#audioOutputSelect').html(
                audioOutputDevices
                    .map(
                        d =>
                            `<option value="${d.deviceId}">${d.label}</option>`)
                    .join('\n'));

            $('#audioOutputSelectWrapper').show();
        }
    });
}
