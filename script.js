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
    'alpha', 'beta', 'henne',
    'delta', 'soeren', 'klaus'
];
// track mapping participant id -> position
let trackMapping = {};
// alle verfügbaren tracks mit participant id -> {audio: track, video: track}
let tracks = {};
// name -> id
let nameMapping = {};
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
    if(!tracks[participant].audio && !tracks[participant].video) {
        delete tracks[participant]
    } else {
        delete tracks[participant][type];
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
        trackMapping[id] = position
    }
}

/**
 * Event für Namensänderungen, ordnet den user korrekt an.
 * @param participant
 * @param displayName
 */
function onNameChange(participant, displayName) {

    nameMapping[displayName] = id;
    // detach this user from current position
    detachUser(participant);
    let position = remoteMappingName.indexOf(displayName);

    if(position >= 0 && tracks[participant]) {
        // detach user in the new position
        for(let i in trackMapping) {
            if(trackMapping[i] === position) {
                detachUser(i);
            }
        }
        attachUser(participant, position)
    }
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
}

function detachUser(id) {
    if (trackMapping[id] != null) {
        console.log("detaching user " + id);
        if(tracks[id].video) {
            tracks[id].video.detach($(`.video-${trackMapping[id].position} video`)[0]);
        }
        if(tracks[id].audio) {
            tracks[id].audio.detach($(`.video-${trackMapping[id].position} audio`)[0]);
        }
        delete trackMapping[id]
    }
}
function attachUser(id, position) {
    if (trackMapping[id] != null) {
        console.log("attaching user " + id);
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
 * That function is called when connection is established successfully
 */
function onConnectionSuccess() {
    $('#roomnamebutton').prop('disabled', false);
}

/**
 *
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

$(document).ready(function() {
    let audio = $('audio');
    for(let i in audio) {
        if(!audio.hasOwnProperty(i)) {
            continue;
        }
        audio[i].volume = 0.7;
    }
    let video = $('.video');
    for(let i in video) {
        if(!video.hasOwnProperty(i)) {
            continue;
        }
        $(video[i]).find('input')[0].value = remoteMappingName[i];
        $(video[i]).find('video').on('resize', onVideoResize).width(videoSize.width).height(videoSize.height);
    }
});

/**
 * This function is called when we disconnect.
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

function connect() {
    const roomName = $('#roomname').val();

    room = connection.initJitsiConference(roomName, confOptions);
    room.setDisplayName("Streamer");
    room.on(JitsiMeetJS.events.conference.TRACK_ADDED, onRemoteTrack);
    room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, onRemoteTrackRemove);
    room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, onConferenceJoined);
    room.on(JitsiMeetJS.events.conference.USER_JOINED, onUserJoin);
    room.on(JitsiMeetJS.events.conference.USER_LEFT, onUserLeft);
    room.on(JitsiMeetJS.events.conference.DISPLAY_NAME_CHANGED, onNameChange);
    room.join();
    $('#roomselector').hide();
    $('#room').show();
}

/**
 *
 */
function unload() {
    room.leave();
    connection.disconnect();
}


function setLevel(id, level) {
    console.log(`setting volume of ${id} to ${level*100}%`);
    let track = $(`.video-${id} audio`)[0];
    track.volume = level;
}

function setName(position, name) {
    console.log(`setting name of ${position} to ${name}`);
    remoteMappingName[position] = name;
    for(let i in trackMapping) {
        if(trackMapping[i] === position) {
            detachUser(i)
        }
    }
    for(let i in nameMapping) {
        if(nameMapping[i] != null) {
            attachUser(nameMapping[i], position)
        }
    }
}
/**
 *
 * @param selected
 */
function changeAudioOutput(selected) { // eslint-disable-line no-unused-vars
    JitsiMeetJS.mediaDevices.setAudioOutputDevice(selected.value);
}

$(window).bind('beforeunload', unload);
$(window).bind('unload', unload);

JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
const initOptions = {};

JitsiMeetJS.init(initOptions);

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
