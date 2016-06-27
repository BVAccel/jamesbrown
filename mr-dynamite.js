// lt --port 3000 --subdomain mrdynomite

var setup            = require('./bot-setup.js');
var responses        = require('./responses.js');

var Botkit           = require('botkit');
var request          = require('request');
var SpotifyWebApi    = require('spotify-web-api-node');
var Spotify          = require('spotify-node-applescript');

var q                = require('q');
var os               = require('os');
var https            = require('https');


if (!setup.slack.clientId || !setup.slack.clientSecret || !setup.server.port) {
  console.log('Error: Specify clientId clientSecret and port in environment');
  process.exit(1);
}

var AUTHENTICATED_USER = setup.spotify.userName;
var PLAYLIST_ID = setup.spotify.playlistId;
var REPORTING_CHANNEL = setup.slack.channel;


var controller = Botkit.slackbot({
    interactive_replies: true,
    json_file_store: './db_slackbutton_bot/',
    logLevel: 'emergency'
});

controller.configureSlackApp({
  clientId: setup.slack.clientId,
  clientSecret: setup.slack.clientSecret,
  scopes: ['bot']
});

controller.setupWebserver(setup.server.port, function(err, webserver) {
  controller.createHomepageEndpoint(controller.webserver);
  controller.createOauthEndpoints(controller.webserver,function(err,req,res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('Success!');
    }
  });
  controller.createWebhookEndpoints(controller.webserver);
});


var _bots = {};
var trackBot = function(bot) {
  _bots[bot.config.token] = bot;
};

controller.on('create_bot',function(bot, config) {
  if (_bots[bot.config.token]) {
    // already online! do nothing.
  } else {
    bot.startRTM(function(err) {
      if (!err) {
        trackBot(bot);
      }
      bot.startPrivateConversation({user: config.createdBy},function(err, convo) {
        if (err) {
          console.log(err);
        } else {
          convo.say('Suuuup. Thanks for inviting me to the team!');
          convo.say('If you feel so inclined, you could make a public channel, invite me, add the channel name to the bot-setup.js file, and then I\'ll broadcast updates stuff goes down.');
        }
      });
    });
  }
});

controller.storage.teams.all(function(err, teams) {
  if (err) {
    throw new Error(err);
  }
  // connect all teams with bots up to slack!
  for (var t in teams) {
    if (teams[t].bot) {
      controller.spawn(teams[t]).startRTM(function(err, bot) {
        if (err) {
          console.log('Error connecting bot to Slack:',err);
        } else {
          trackBot(bot);
        }
      });
    }
  }
});

controller.on('rtm_open',function(bot) {
  console.log('** The RTM api just connected!');
});

controller.on('rtm_close',function(bot) {
  console.log('** The RTM api just closed');
});


var spotifyApi = new SpotifyWebApi({
  redirectUri: setup.spotify.redirectUri,
  clientId: setup.spotify.clientId,
  clientSecret: setup.spotify.clientSecret,
  accessToken: setup.spotify.accessToken,
  refreshToken: setup.spotify.refreshToken
});


// Authentication ===============================================

// When our access token will expire
var tokenExpirationEpoch;

spotifyApi.refreshAccessToken().then(function(data) {
  spotifyApi.setAccessToken(data.body['access_token']);
  tokenExpirationEpoch = (new Date().getTime() / 1000) + data.body['expires_in'];
  console.log('Retrieved token. It expires in ' + Math.floor(tokenExpirationEpoch - new Date().getTime() / 1000) + ' seconds!');
});


// var authorizationCode = "AQAW9K7cLNwJSrZro1fP0pdkYbOEu5EIwUYXnCgalJfbnwwovn2SSmkqZaw-eGz1KbmCT6Yw8_0nwN2bqfhgV0kep_boIFVoXcSmdo0BDeuVGGl72hlTLU412ny7q5r6-PVpkxXkhSkH3otuML7om83RW9L_whTOzELfZOjjWETk6_0dMSPmAg4Vx2VoyqcF-4YveYMQ62SZycbkFuW4Piuf40H34p62_w37zRqvjtRIfP_xoYa4Vru38NlwvZC5tVFHBEIOFrUsSdi-azOgzldK9HH0-ORsPG3tXcHB9wYtG5qNcSFhQa4FyzFpH9KBxgVBH-r-ihp_u3IbTw";

// spotifyApi.authorizationCodeGrant(authorizationCode).then(function(data) {
//   // Set the access token and refresh token
//   console.log('access token: ' + data.body['access_token']);
//   console.log('refresh token: ' + data.body['refresh_token']);

//   spotifyApi.setAccessToken(data.body['access_token']);
//   spotifyApi.setRefreshToken(data.body['refresh_token']);

//   // Save the amount of seconds until the access token expired
//   tokenExpirationEpoch = (new Date().getTime() / 1000) + data.body['expires_in'];
//   console.log('Retrieved token. It expires in ' + Math.floor(tokenExpirationEpoch - new Date().getTime() / 1000) + ' seconds!');
// }, function(err) {
//   console.log('Something went wrong when retrieving the access token!', err.message);
// });


// Watchers  ===============================================

var lastTrackId;

var checkRunning = function() {
  var deferred = q.defer();
  Spotify.isRunning(function(err, isRunning) {
    if (err || !isRunning) {
      return deferred.resolve(false);
    }
    return deferred.resolve(true);
  });
  return deferred.promise;
};

var checkForTrackChange = function() {
  Spotify.getTrack(function(err, track) {
    if (track && (track.id !== lastTrackId)) {
      if (!REPORTING_CHANNEL) {
        return;
      }
      lastTrackId = track.id;
    }
  });
};

setInterval(function() {
  checkRunning()
  .then(function(running) {
    if (running) {
      checkForTrackChange();
    }
    else {
      if(lastTrackId !== null) {
        bot.say({
          text: 'Oh no! Where did Spotify go? It doesn\'t seem to be running 😨',
          channel: REPORTING_CHANNEL
        });
        lastTrackId = null;
      }
    }
  });
}, 5000);

var tick = 0;
setInterval(function() {
  tick++;

  if (tick > 1500) {
    tick = 0;

    // Refresh token and print the new time to expiration.
    spotifyApi.refreshAccessToken()
      .then(function(data) {
        spotifyApi.setAccessToken(data.body['access_token']);
        tokenExpirationEpoch = (new Date().getTime() / 1000) + data.body['expires_in'];
        console.log('Refreshed token.');
      }, function(err) {
        console.log('Could not refresh the token!', err.message);
      });
  }
}, 1000);


// Helper Functions ===============================================


var createTrackObject = function(data) {
  var artists = data.artists.map(function(artistObj) {
    return artistObj.name;
  }).join(', ');
  return {
    "name": data.name,
    "artist": artists,
    "album": data.album.name,
    "artworkUrls": {
      "medium": data.album.images[1].url,
      "small": data.album.images[2].url
    },
    "formattedTrackTitle": "_" + data.name + "_ by *" + artists + "*",
    "trackId": data.id
  };
};


var normalizeTrackId = function(rawTrackId) {
  var trackId = rawTrackId;
  if (rawTrackId.indexOf('spotify:track:') !== -1) {
    trackId = rawTrackId.split(':track:')[1];
  } else if (rawTrackId.indexOf('//open.spotify.com/track/') !== -1) {
    trackId = rawTrackId.split('/track/')[1];
  }
  return trackId;
};

var getRealNameFromId = function(bot, userId) {
  var deferred = q.defer();
  var realName = '';
  bot.api.users.info({user: userId}, function(err, response) {
    realName = response.user.real_name.toLowerCase();
    deferred.resolve(realName);
  });
  return deferred.promise;
};

var logToConsole = function(userName, song, artists) {
  console.log(userName + ' just added: ' + song + ' by ' + artists.join(', '));
};

var reorderPlaylist = function(trackInfo, trackPosition, currentTrackPosition) {
  spotifyApi.reorderTracksInPlaylist(AUTHENTICATED_USER, PLAYLIST_ID, trackPosition, currentTrackPosition + 1, {"range_length": 1}).then(function(data) {
    logToConsole(userName, trackInfo.name, trackInfo.artists);
  });
};

var addTrack = function(trackInfo, currentTrackPosition) {
  spotifyApi.addTracksToPlaylist(AUTHENTICATED_USER, PLAYLIST_ID, 'spotify:track:' + trackInfo.trackId, {position: currentTrackPosition + 1}).then(function(response) {
    logToConsole(userName, trackInfo.name, trackInfo.artists);
  });
};


// Listeners  ===============================================

// receive an interactive message, and reply with a message that will replace the original
controller.on('interactive_message_callback', function(bot, message) {

  if (message.callback_id !== 'add_this_track') {
    return false;
  }

  var action = message.actions[0];

  if (action.name === 'no' || action.name === 'nvm') {
    bot.replyInteractive(message, {
      text: 'maybe you\'ll work up the courage one day.'
    });
  } else if (action.name === 'yes') {
    getRealNameFromId(bot, message.user).then(function(userName) {
      var trackInfo = JSON.parse(action.value);
      spotifyApi.getPlaylist(AUTHENTICATED_USER, PLAYLIST_ID)
        .then(function(data) {
          var playlistOrder = data.body.tracks.items.map(function(item) {
            return item.track.id;
          });
          Spotify.getState(function(err, state) {
            var currentTrackId = normalizeTrackId(state.track_id);
            var currentTrackPosition = playlistOrder.indexOf(currentTrackId);
            if (playlistOrder.indexOf(trackInfo.trackId) !== -1) {
              var trackPosition = playlistOrder.indexOf(trackInfo.trackId);
              bot.reply(message, '*Moving ' + trackInfo.formattedTrackTitle + ' to the top of the queue.*');
              reorderPlaylist(trackInfo, trackPosition, currentTrackPosition);
            } else {
              bot.say(responses.addedToPlaylist(REPORTING_CHANNEL, userName, trackInfo));
              bot.reply(message, trackInfo.formattedTrackTitle + ' added to playlist.');
              addTrack(trackInfo, currentTrackPosition);
            }
          });
        });
    });
  }

});

controller.hears([/search ([\s\S]+)/i], 'direct_message', function(bot, message) {

  var searchQuery = message.match[1];
  var searchResults = [];

  spotifyApi.searchTracks(searchQuery).then(function(data) {
      var results = data.body.tracks.items;

      if (results.length === 0) {
        bot.reply(message, 'Sorry, no results.');
        return false;
      }

      for (var i = 0; i < results.length; i++) {
        if (i >= 3) {
          break;
        }
        searchResults.push(createTrackObject(results[i]));
      }

      var askIfSure = function(response, convo, trackInfo) {
        getRealNameFromId(bot, message.user).then(function(userName) {
          bot.reply(message, responses.proceed(trackInfo));
        });
      };

      bot.startConversation(message, function(err, convo) {
        convo.ask(responses.searchResults(searchResults), [{
          pattern: '([1-3])',
          callback: function(response, convo) {
            var index = parseInt(response.match[1], 10) - 1;
            var trackInfo = searchResults[index];
            askIfSure(response, convo, trackInfo);
            convo.next();
          }
        }, {
          pattern: 'nvm',
          callback: function(response, convo) {
            convo.say('maybe you\'ll work up the courage one day.');
            convo.next();
          }
        }]);
      });

    }, function(err) {
      bot.reply(message, 'Looks like this error just happened: `' + err.message + '`');
    });
});


controller.hears([/add .*track[:\/](\d\w*)/i], 'direct_message', function(bot, message) {

  var trackId = normalizeTrackId(message.match[1]);

  spotifyApi.getTrack(trackId).then(function(response) {
    var trackInfo = createTrackObject(response.body);
    getRealNameFromId(bot, message.user).then(function(userName) {
      bot.reply(message, responses.proceed(trackInfo));
    });
  }, function(err) {
    bot.reply(message, 'Looks like this error just happened: `' + err.message + '`');
  });
});


controller.hears(['/what\'?s next/', 'up next', 'next up', '/what\'?s up/'], 'direct_message,direct_mention', function(bot, message) {
  spotifyApi.getPlaylist(AUTHENTICATED_USER, PLAYLIST_ID)
    .then(function(data) {
      var playlist = data.body.tracks.items;
      var playlistOrder = playlist.map(function(item) {
        return item.track.id;
      });
      Spotify.getState(function(err, state) {
        var currentTrackId = normalizeTrackId(state.track_id);
        var currentTrackPosition = playlistOrder.indexOf(currentTrackId);
        var lastIndex = playlistOrder.length - 1;
        var nextThreeTracks = [];
        for (var i = 1; i <= 3; i++) {
          var nextIndex = currentTrackPosition + i;
          if (nextIndex - lastIndex >= 0) {
            nextIndex = nextIndex - lastIndex;
          }
          var artists = playlist[nextIndex].track.artists.map(function(artistObj) {
            return artistObj.name;
          }).join(', ');
          nextThreeTracks.push({
            name: playlist[nextIndex].track.name,
            artist: artists
          });
        }
        bot.reply(message, responses.upNext(nextThreeTracks));
      });
    });
});

controller.hears(['help'], 'direct_message', function(bot, message) {
  bot.reply(message, responses.help());
});

controller.hears(['info'], 'direct_message,direct_mention,mention', function(bot, message) {
  Spotify.getTrack(function(err, track){
    if (track) {
      bot.reply(message, responses.info(track));
    } else {
      bot.reply(message, 'sorry, no track.');
    }
  });
});

controller.hears(['detail'], 'direct_message,direct_mention,mention', function(bot, message) {
  Spotify.getTrack(function(err, track) {
    if (track) {
      var trackId = normalizeTrackId(track.id);
      spotifyApi.getTrack(trackId).then(function(response) {
        var trackInfo = createTrackObject(response.body);
        bot.reply(message, responses.detail(trackInfo));
      });
    } else {
      bot.reply(message, 'sorry, no track.');
    }
  });
});

controller.hears(['heysup'], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.api.reactions.add({
    timestamp: message.ts,
    channel: message.channel,
    name: 'radio',
  });
  bot.reply(message, "Hello.");
});
