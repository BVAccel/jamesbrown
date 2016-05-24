var setup            = require('./bot_setup.js');

var Botkit           = require('botkit');
var Spotify          = require('spotify-node-applescript');
var SpotifyWebApi    = require('spotify-web-api-node');

var https            = require('https');
var os               = require('os');
var q                = require('q');

var lastTrackId;
var channelId;

var playlistId = '14KDKEQGjVcdTzJrswI6Zm';

var controller = Botkit.slackbot({
    debug: false,
});

var bot = controller.spawn({
    token: setup.token
}).startRTM();


var spotifyApi = new SpotifyWebApi({
  'clientId': setup.spotifyClientId,
  'clientSecret': setup.spotifyClientSecret,
  'redirectUri': 'http://dev.tylershambora.com/music'
});


// When our access token will expire
var tokenExpirationEpoch;

// First retrieve an access token
spotifyApi.authorizationCodeGrant(setup.authorizationCode).then(function(data) {
  // Set the access token and refresh token
  spotifyApi.setAccessToken(data.body['access_token']);
  spotifyApi.setRefreshToken(data.body['refresh_token']);

  // Save the amount of seconds until the access token expired
  tokenExpirationEpoch = (new Date().getTime() / 1000) + data.body['expires_in'];
  console.log('Retrieved token. It expires in ' + Math.floor(tokenExpirationEpoch - new Date().getTime() / 1000) + ' seconds!');
}, function(err) {
  console.log('Something went wrong when retrieving the access token!', err.message);
});


// Continually print out the time left until the token expires..
var numberOfTimesUpdated = 0;

setInterval(function() {
  console.log('Time left: ' + Math.floor((tokenExpirationEpoch - new Date().getTime() / 1000)) + ' seconds left!');

  // OK, we need to refresh the token. Stop printing and refresh.
  if (++numberOfTimesUpdated > 5) {
    clearInterval(this);

    // Refresh token and print the new time to expiration.
    spotifyApi.refreshAccessToken()
      .then(function(data) {
        tokenExpirationEpoch = (new Date().getTime() / 1000) + data.body['expires_in'];
        console.log('Refreshed token. It now expires in ' + Math.floor(tokenExpirationEpoch - new Date().getTime() / 1000) + ' seconds!');
      }, function(err) {
        console.log('Could not refresh the token!', err.message);
      });
  }
}, 1000);



var init = function() {
    bot.api.channels.list({}, function(err, response) {
        if(err) {
            throw new Error(err);
        }

        if (response.hasOwnProperty('channels') && response.ok) {
            var total = response.channels.length;
            for (var i = 0; i < total; i++) {
                var channel = response.channels[i];
                if(verifyChannel(channel)) {
                    return;
                }
            }
        }
    });

    bot.api.groups.list({}, function(err, response) {
        if(err) {
            throw new Error(err);
        }

        if (response.hasOwnProperty('groups') && response.ok) {
            var total = response.groups.length;
            for (var i = 0; i < total; i++) {
                var channel = response.groups[i];
                if(verifyChannel(channel)) {
                    return;
                }
            }
        }
    });
};


// Helper Functions ===============================================

var getRealNameFromId = function(bot, userId) {
  var deferred = q.defer();
  var realName = '';
  bot.api.users.info({user: userId}, function(err, response) {
    realName = response.user.real_name.toLowerCase();
    deferred.resolve(realName);
  });
  return deferred.promise;
};



// Listeners  ===============================================

controller.hears([/add ([\d\w]*)/], 'direct_message', function(bot, message) {
  var trackId = message.match[1];
  spotifyApi.getTrack(trackId).then(function(response) {

    console.dir();
    var albumArtUrl = response.body.album.images[0].url;
    var title = response.body.name;
    var artists = response.body.artists.map(function(artistObj) {
      return artistObj.name;
    });
    var formattedSongTitle = '_' + title + '_ by *' + artists.join(', ') + '*';

    getRealNameFromId(bot, message.user).then(function(userName) {
      bot.startConversation(message, function(err, convo) {
        convo.say('Looks like you\'re trying to add: ' + formattedSongTitle);
        convo.ask({
          text: 'Would you like to proceed?',
          attachments: [{
            fallback: '*YES* to confirm',
            text: '*YES* to confirm',
            color: 'good',
            mrkdwn_in: ['fallback', 'text']
          }, {
            fallback: '*NO* to abort',
            text: '*NO* to abort',
            color: 'danger',
            mrkdwn_in: ['fallback', 'text']
          }]
        }, [{
          pattern: bot.utterances.yes,
          callback: function(response, convo) {
            spotifyApi.addTracksToPlaylist('tshamz', playlistId, 'spotify:track:' + trackId).then(function(response) {
              bot.reply(message, 'Good News! I was able to successfully add your track to the playlist!');
              bot.say({
                channel: channelId,
                text: '*'+ userName +'* just added a song to the playlist\n' + albumArtUrl,
                attachments: [{
                  fallback: formattedSongTitle,
                  text: formattedSongTitle,
                  color: '#23CF5F',
                  mrkdwn_in: ['fallback', 'text']
                }]
              });
            }, function(err) {
              bot.reply(message, 'Oof! Looks like something went wrong and I couldn\'t add your song. Try adding it again.');
            });
          }
        }, {
          pattern: bot.utterances.no,
          callback: function(response, convo) {
            convo.say('maybe you\'ll work up the courage one day.');
            convo.next();
          }
        }, {
          default: true,
          callback: function(response, convo) {
            convo.repeat();
            convo.next();
          }
        }]);
      });
    });
  }, function(err) {
    bot.reply(message, 'Looks like this error just happened: `' + err.message + '`');
    bot.reply(message, 'See if you can correct it and try again.');
  });
});

controller.hears(['help'],'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,'You can say these things to me:\n'+
        'info - I will tell you about this track\n'+
        'detail - I will tell you more about this track\n'
    );
});

controller.hears(['hello','hi'],'direct_message,direct_mention,mention',function(bot,message) {

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'radio',
    }, function(err,res) {
        if (err) {
            bot.botkit.log("Failed to add emoji reaction :(",err);
        }
    });


    controller.storage.users.get(message.user,function(err,user) {
        if (user && user.name) {
            bot.reply(message,"Hello " + user.name + "!!");
        }
        else {
            bot.reply(message,"Hello.");
        }
    });
});

/*
track = {
    artist: 'Bob Dylan',
    album: 'Highway 61 Revisited',
    disc_number: 1,
    duration: 370,
    played count: 0,
    track_number: 1,
    starred: false,
    popularity: 71,
    id: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc',
    name: 'Like A Rolling Stone',
    album_artist: 'Bob Dylan',
    spotify_url: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc' }
}
*/
controller.hears(['what is this','what\'s this','info','playing','what is playing','what\'s playing'],'direct_message,direct_mention,mention', function(bot, message) {
    Spotify.getTrack(function(err, track){
        if(track) {
            lastTrackId = track.id;
            bot.reply(message,'This is ' + trackFormatSimple(track) + '!');
        }
    });
});

controller.hears(['detail'],'direct_message,direct_mention,mention', function(bot, message) {
    Spotify.getTrack(function(err, track){
        if(track) {
            lastTrackId = track.id;
            getArtworkUrlFromTrack(track, function(artworkUrl) {
                bot.reply(message, trackFormatDetail(track)+"\n"+artworkUrl);
            });
        }
    });
});


function inviteMessage(inviter, channel) {
    Spotify.getTrack(function(err, track){
        var nowPlaying;
        var welcomeText = `Thanks for inviting me, ${inviter.name}! Good to be here :)\n`;

        if(track) {
            lastTrackId = track.id;
            getArtworkUrlFromTrack(track, function(artworkUrl) {
                bot.say({
                    text: welcomeText+'Currently playing: '+trackFormatSimple(track),
                    channel: channel.id
                });
            });
        }
        else {
            bot.say({
                text: welcomeText+'There is nothing currently playing',
                channel: channel.id
            });
        }
    });
}


setInterval(() => {
    checkRunning()
    .then(function(running) {
        if(running) {
            checkForTrackChange();
        }
        else {
            if(lastTrackId !== null) {
                bot.say({
                    text: 'Oh no! Where did Spotify go? It doesn\'t seem to be running 😨',
                    channel: channelId
                });
                lastTrackId = null
            }
        }
    });
}, 5000);

function checkRunning() {
    var deferred = q.defer();

    Spotify.isRunning(function(err, isRunning) {
        if(err || !isRunning) {
            return deferred.resolve(false);
        }

        return deferred.resolve(true);
    });

    return deferred.promise;
}

function checkForTrackChange() {
    Spotify.getTrack(function(err, track) {
        if(track && (track.id !== lastTrackId)) {
            if(!channelId) return;

            lastTrackId = track.id;

            getArtworkUrlFromTrack(track, function(artworkUrl) {
                // bot.say({
                //     text: `Now playing: ${trackFormatSimple(track)} (${track['played_count']} plays)\n${artworkUrl}`,
                //     channel: channelId
                // });
            });
        }
    });
}

var trackFormatSimple = (track) => `_${track.name}_ by *${track.artist}*`;
var trackFormatDetail = (track) => `_${track.name}_ by _${track.artist}_ is from the album *${track.album}*\nIt has been played ${track['played_count']} time(s).`;
var getArtworkUrlFromTrack = (track, callback) => {
    var trackId = track.id.split(':')[2];
    var reqUrl = 'https://api.spotify.com/v1/tracks/'+trackId;
    var req = https.request(reqUrl, function(response) {
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function() {
            var json = JSON.parse(str);
            if(json && json.album && json.album.images && json.album.images[1]) {
                callback(json.album.images[1].url);
            }
            else {
                callback('');
            }
        });
    });
    req.end();

    req.on('error', function(e) {
      console.error(e);
    });
};

controller.hears(['uptime','identify yourself','who are you','what is your name'],'direct_message,direct_mention,mention',function(bot,message) {
    var hostname = os.hostname();
    var uptime = formatUptime(process.uptime());

    bot.reply(message,':robot_face: I am a bot named <@' + bot.identity.name +'>. I have been running for ' + uptime + ' on ' + hostname + ".");
});

function formatUptime(uptime) {
    var unit = 'second';
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'minute';
    }
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'hour';
    }
    if (uptime != 1) {
        unit = unit +'s';
    }

    uptime = uptime + ' ' + unit;
    return uptime;
}

function verifyChannel(channel) {
    if(channel && channel.name && channel.id && setup.channel && channel.name == setup.channel) {
        channelId = channel.id;
        console.log('** ...chilling out on #' + channel.name);
        return true;
    }

    return false;
}

init();
