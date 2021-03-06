const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = module.exports.io = require('socket.io')(server);
const fs = require('fs');

const config = require('./config');
const game = require('./game');

io.on('connection', (socket) => {
  socket.on('join', (roomID, teamID) => {
    roomID = roomID || 'null';
    socket.join(roomID);

    const room = io.sockets.adapter.rooms[roomID];
    const players = room.players || (room.players = []);
    const teams = room.teams || (room.teams = {});

    // Spectators
    if (room.grid || teamID === undefined) {
      console.log(`Spectator ${socket.id} joined ${roomID}`);
      return;
    }

    // Players
    const playerID = String(room.players.length + 1);
    teamID = teamID || playerID;

    // Player/Team management
    let team = teams[teamID];

    if (!team && Object.keys(teams).length < config.teams.amount) {
      team = (teams[teamID] = []);
    }

    if (team && team.length < config.teams.size) {
      const player = socket.player = {
        id: playerID,
        team: teamID,
        x: 0,
        y: 0,
        direction: '',
      };

      players.push(player);
      team.push(player);
    }

    if (socket.player) {
      console.log(`Player ${socket.id} (ID: ${socket.player.id}, Team: ${socket.player.team}) joined ${roomID}`);
    } else {
      console.log(`Spectator ${socket.id} joined ${roomID}`);
      return;
    }

    // Start the game already!
    const fullTeams = Object.keys(teams).filter(
      id => teams[id].length === config.teams.size
    );

    if (fullTeams.length === config.teams.amount) {
      game.start(room);
      setTimeout(() => game.next(room), config.delay.initial);

      console.log(`Game started in room ${roomID}`);
    }
  });

  socket.on('replay', (roomID, replayFile) => {
    roomID = roomID || 'null';
    socket.join(roomID + "?replay");

    // Find the latest played game
    fs.readdir('saves', function(err, filenames) {
      if (err) {
        return;
      }

      let save = filenames.find((name) => name === replayFile);

      fs.readFile('saves/' + save, "utf8", function(err, data) {
        if (err) {
          return;
          // console.log('naw wonkey');
        }

        data = data.split('\n\n');

        let players = data[0].split('\n')
          .map((line) => {
            let playerID, teamID;

            line.replace(/^(\d)+: (.*)$/, (line, id, team) => {
              playerID = id;
              teamID = team;
            });

            return {
              team: teamID,
              id: playerID
            };
          });

        replay(socket, players, data.slice(1));
      });
    });
  });

  socket.on('move', (direction) => {
    const player = socket.player;

    if (player && 'uldr'.indexOf(direction) !== -1) {
      player.direction = direction;
    }
  });

  socket.on('disconnecting', () => {
    const roomID = Object.keys(socket.rooms).find(id => id !== socket.id);
    const room = io.sockets.adapter.rooms[roomID];

    if (!room) {
      return;
    }

    if (socket.player) {
      console.log(`Player ${socket.id} (ID: ${socket.player.id}, Team: ${socket.player.team}) left ${roomID}`);

      if (room.grid) { // Match already started
        game.killPlayer(socket.player, room);

        const aliveTeams = game.getTeams(room, true);

        if (aliveTeams.length === 1) {
          const aliveTeamID = aliveTeams[0][0].team;

          game.endMatch(room, aliveTeamID);
          console.info(`Match ended in room: ${roomID}. Winners: ${aliveTeamID}.`);
        }
      } else { // Match not yet started
        const player = socket.player;
        const team = room.teams[player.team];

        // Remove the player
        room.players.splice(room.players.indexOf(player), 1);
        team.splice(team.indexOf(player), 1);

        // Deletes the team if empty
        if (team.length === 0) {
          delete room.teams[player.team];
        }
      }
    } else {
      console.log(`Spectator ${socket.id} left ${roomID}`);
    }
  });
});

function replay(socket, players, grids) {

  if (!grids.length || !socket.connected)
    return;

  let grid = grids[0].trim()
    .replace(/\|/g, '')
    .replace(/—/g, '')
    .split('\n')
    .map((line) => line.split(''))
    .filter((arr) => arr.length);

  socket.emit('draw', grid, players);

  setTimeout(() => replay(socket, players, grids.slice(1)), config.delay.default);
}

/* Web */

app.use('/public', express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(`${__dirname}/index.html`);
});

app.get('/:room', (req, res) => {
  res.sendFile(`${__dirname}/room.html`);
});

/* Sockets */

server.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});
