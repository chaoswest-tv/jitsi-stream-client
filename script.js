// DISABLE RIGHTCLICK
document.addEventListener('contextmenu', event => event.preventDefault());

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
let remoteMappingName = new Array(9);
// alle verfügbaren tracks mit id -> {audio: track, video: track, position: number}
let tracks = {};

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
            if(messageData.data[0] != 176) return;
            if(messageData.data[1] > 7) messageData.data[1] -= 8;
            setLevel(messageData.data[1], messageData.data[2]/127);
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
    for(let i in tracks) {
        if(tracks.hasOwnProperty(i)) {
            if(tracks[i].position >= 0) {
                part.push(i)
            }
        }
    }
    room.selectParticipants(part);
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
    if (tracks[participant] == null)
        return;
    tracks[participant][track.getType()] = track;
    console.log(`mapping ${track.getType()} track from ${participant}`);
    if(tracks[participant].audio && tracks[participant].video && remoteMappingName.indexOf(room.getParticipantById(participant).getDisplayName().toLowerCase()) >= 0) {
        attachUser(participant, remoteMappingName.indexOf(room.getParticipantById(participant).getDisplayName().toLowerCase()));
    }
}

/**
 * Event wenn ein Mediastream entfernt wurde.
 * Räumt die Track tracker objekte auf und entfernt - wenn vorhanden - die entsprechende zuordnung zum media element
 * @param track
 */
function onRemoteTrackRemove(track) {
    const participant = track.getParticipantId();
    const type = track.getType();
    if(tracks[participant] != null && tracks[participant][type]) {
        console.log(`detaching ${type} track from ${participant}`);
        tracks[participant][type].detach($(`.video-${tracks[participant].position} ${type}`)[0]);
    }
    delete tracks[participant][type];
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
    tracks[id] = {position: -1};
    console.log(tracks[id]);
    if(remoteMappingName.indexOf(user.getDisplayName().toLowerCase()) >= 0) {
        selectParticipants();
    }
    updateParticipantList();
}

/**
 * Event für Namensänderungen, ordnet den user korrekt an.
 * @param participant
 * @param displayName
 */
function onNameChange(participant, displayName) {
    // detach this user from current position
    detachUser(participant);
    let position = remoteMappingName.indexOf(displayName.toLowerCase());

    if(position >= 0 && tracks[participant]) {
        // detach user in the new position
        for(let i in tracks) {
            if(tracks[i].position === position) {
                detachUser(i);
                break;
            }
        }
        attachUser(participant, position)
    }
    selectParticipants();
    updateParticipantList();
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
    updateParticipantList();
    selectParticipants()
}

/**
 * Detaches the Tracks of participant with ID from it's position.
 * @param id
 */
function detachUser(id) {
    if (tracks[id] != null) {
        console.log("detaching user " + id);
        if(tracks[id].video) {
            tracks[id].video.detach($(`.video-${tracks[id].position} video`)[0]);
        }
        if(tracks[id].audio) {
            tracks[id].audio.detach($(`.video-${tracks[id].position} audio`)[0]);
        }
        tracks[id].position = -1;
    }
}

/**
 * Attaches participant with ID to POSITION
 * @param id
 * @param position
 */
function attachUser(id, position) {
    // check if track exists, and is not attached to another element already.
    if (tracks[id] != null && tracks[id].position < 0) {
        console.log(`attaching user ${id} to ${position}`);
        // check if there is already some participant attached to this position and detach the tracks
        for(let i in tracks) {
            if(tracks.hasOwnProperty(i) && tracks[i].position === position) {
                detachUser(i);
            }
        }
        // finally attach new participant to position
        tracks[id].position = position;
        if (tracks[id].video) {
            tracks[id].video.attach($(`.video-${tracks[id].position} video`)[0]);
        }
        if(tracks[id].audio) {
            tracks[id].audio.attach($(`.video-${tracks[id].position} audio`)[0]);
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
function connect(e) {
    e.preventDefault();
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

    // initiaize fields with values
    for(let i = 0; i<remoteMappingName.length; i++) {
        $('.volume-' + i + ' input[type="text"]').val(remoteMappingName[i]);
        $('.volume-' + i + ' input[type="range"]').val(0.7);
        $('.video-' + i + ' video').on('resize', onVideoResize).width(videoSize.width).height(videoSize.height);
        $('.video-' + i + ' span').text(remoteMappingName[i]);
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
    if(id < remoteMappingName.length) {
        let track = $(`.video-${id} audio`)[0];
        $('.volume-' + id + ' .volume').text(Math.round(level*100) + "%");
        $('.volume-' + id + ' input[type="range"]').val(level);
        track.volume = level;
    }
}

/**
 * Sets the name of a position
 * @param position
 * @param name
 */
function setName(position, name) {
    name = name.toLowerCase();
    console.log(`setting name of ${position} to ${name}`);
    remoteMappingName[position] = name;
    $('.video-' + position + ' .name').text(name);
    for(let i in tracks) {
        if(tracks.hasOwnProperty(i) && tracks[i].position === position) {
            detachUser(i);
            break;
        }
    }
    let participants = room.getParticipants();
    for(let i = 0; i < participants.length; i++) {
        if(participants[i].getDisplayName().toLowerCase() === name) {
            attachUser(participants[i].getId(), position);
            break;
        }
    }
    selectParticipants();
    window.localStorage.setItem('remoteMappingName', JSON.stringify(remoteMappingName));
}

function reload(position) {
    for(let i in tracks) {
        if(tracks.hasOwnProperty(i) && tracks[i].position === position) {
            detachUser(i);
            attachUser(i, position);
        }
    }
}

function updateParticipantList() {
    $('.available-users').text(room.getParticipants().map(p => p.getDisplayName()).join(', '));
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

if(window.localStorage.getItem('remoteMappingName') !== null) {
    remoteMappingName = JSON.parse(window.localStorage.getItem('remoteMappingName'));
}
