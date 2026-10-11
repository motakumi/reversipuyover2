const express = require('express');
const http = require('http');
const { randomInt } = require('node:crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // スマホなど外部からの接続を許可する設定
});
const rooms = new Map();
const MAX_ROOM_PLAYERS = 2;

// パソコン内のゲームファイル（HTMLやJS）をブラウザに見せる設定
app.use(express.static(__dirname));

function createRoomCode() {
    let roomCode;
    do {
        roomCode = String(Math.floor(1000 + Math.random() * 9000));
    } while (rooms.has(roomCode));
    return roomCode;
}

function getRoomState(roomCode, room) {
    return {
        roomCode,
        started: room.started,
        players: [...room.players.entries()].map(([socketId, name]) => ({
            socketId,
            name,
            isHost: socketId === room.hostId
        }))
    };
}

function emitRoomState(roomCode, room) {
    io.to(roomCode).emit('roomState', getRoomState(roomCode, room));
}

function emitBattleOjamaPending(roomCode, room) {
    for (const socketId of room.players.keys()) {
        io.to(socketId).emit('battleOjamaPending', {
            roomCode,
            count: room.pendingOjama.get(socketId) || 0
        });
    }
}

function normalizePlayerName(name) {
    return typeof name === 'string' && name.trim()
        ? Array.from(name.trim()).slice(0, 7).join('')
        : 'プレイヤー';
}

// プレイヤーが接続してきたときの処理
io.on('connection', (socket) => {
    console.log('プレイヤーが接続しました！ ID:', socket.id);

    socket.on('createRoom', (request, callback) => {
        if (typeof request === 'function') {
            callback = request;
            request = {};
        }
        const roomCode = createRoomCode();
        const playerName = normalizePlayerName(request?.playerName);
        const room = {
            hostId: socket.id,
            players: new Map([[socket.id, playerName]]),
            started: false,
            pairSeed: null,
            result: null,
            returnedPlayers: new Set(),
            pendingOjama: new Map()
        };
        rooms.set(roomCode, room);
        socket.data.roomCode = roomCode;
        socket.join(roomCode);

        const result = { success: true, ...getRoomState(roomCode, room) };
        emitRoomState(roomCode, room);
        socket.emit('roomCreated', result);
        if (typeof callback === 'function') callback(result);
    });

    socket.on('joinRoom', (request, callback) => {
        const roomCode = typeof request === 'string' ? request : request?.roomCode;
        const room = rooms.get(roomCode);

        if (!room) {
            const result = { success: false, error: '指定された部屋が見つかりません。' };
            socket.emit('roomError', result);
            if (typeof callback === 'function') callback(result);
            return;
        }
        if (room.players.size >= MAX_ROOM_PLAYERS) {
            const result = { success: false, error: 'この部屋は満員です。' };
            socket.emit('roomError', result);
            if (typeof callback === 'function') callback(result);
            return;
        }
        if (room.started) {
            const result = { success: false, error: 'この対戦はすでに開始されています。' };
            socket.emit('roomError', result);
            if (typeof callback === 'function') callback(result);
            return;
        }

        const playerName = normalizePlayerName(request?.playerName);
        room.players.set(socket.id, playerName);
        socket.data.roomCode = roomCode;
        socket.join(roomCode);

        const result = { success: true, ...getRoomState(roomCode, room) };
        emitRoomState(roomCode, room);
        socket.emit('roomJoined', result);
        if (typeof callback === 'function') callback(result);
    });

    socket.on('startBattle', (callback) => {
        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);
        if (!room || room.hostId !== socket.id) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'ホストのみ対戦を開始できます。' });
            }
            return;
        }
        if (room.players.size < MAX_ROOM_PLAYERS) {
            if (typeof callback === 'function') {
                callback({ success: false, error: '相手が参加するまで対戦を開始できません。' });
            }
            return;
        }

        if (room.started) {
            if (typeof callback === 'function') callback({ success: false, error: '対戦はすでに開始されています。' });
            return;
        }

        room.started = true;
        room.pairSeed = randomInt(1, 0x100000000);
        room.result = null;
        room.returnedPlayers.clear();
        room.pendingOjama = new Map([...room.players.keys()].map((playerId) => [playerId, 0]));
        io.to(roomCode).emit('battleStarted', { roomCode, pairSeed: room.pairSeed });
        if (typeof callback === 'function') callback({ success: true, roomCode, pairSeed: room.pairSeed });
    });

    socket.on('battleLost', (request) => {
        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);
        if (!room || !room.started || !room.players.has(socket.id)) return;
        if (request?.roomCode !== roomCode || room.result) return;

        const winnerId = [...room.players.keys()].find((playerId) => playerId !== socket.id);
        if (!winnerId) return;

        room.result = { roomCode, loserId: socket.id, winnerId };
        io.to(roomCode).emit('battleResult', room.result);
    });

    socket.on('battleReturnToRoom', (callback) => {
        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);
        if (!room || !room.result || !room.players.has(socket.id)) {
            if (typeof callback === 'function') {
                callback({ success: false, error: '対戦結果を確認できません。' });
            }
            return;
        }

        room.returnedPlayers.add(socket.id);
        if (room.returnedPlayers.size === room.players.size) {
            room.started = false;
            room.pairSeed = null;
            room.result = null;
            room.returnedPlayers.clear();
            room.pendingOjama.clear();
            emitRoomState(roomCode, room);
        }
        if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('battleState', (request) => {
        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);
        if (!room || !room.started || !room.players.has(socket.id)) return;
        if (request?.roomCode !== roomCode || !request.state) return;

        socket.to(roomCode).emit('opponentState', {
            roomCode,
            socketId: socket.id,
            state: request.state
        });
    });

    socket.on('battleOjama', (request) => {
        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);
        if (!room || !room.started || room.result || !room.players.has(socket.id)) return;
        if (request?.roomCode !== roomCode ||
            !Number.isSafeInteger(request.count) || request.count < 1 || request.count > 72) return;

        const opponentId = [...room.players.keys()].find((playerId) => playerId !== socket.id);
        if (!opponentId) return;

        const ownPending = room.pendingOjama.get(socket.id) || 0;
        const cancelled = Math.min(ownPending, request.count);
        room.pendingOjama.set(socket.id, ownPending - cancelled);
        const remainingAttack = request.count - cancelled;
        if (remainingAttack > 0) {
            room.pendingOjama.set(opponentId, (room.pendingOjama.get(opponentId) || 0) + remainingAttack);
        }
        emitBattleOjamaPending(roomCode, room);
    });

    socket.on('battleOjamaLanded', (request, callback) => {
        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);
        if (!room || !room.started || room.result || !room.players.has(socket.id) ||
            request?.roomCode !== roomCode) {
            if (typeof callback === 'function') {
                callback({ success: false, error: '対戦中のおじゃまぷよを確認できません。' });
            }
            return;
        }

        const count = room.pendingOjama.get(socket.id) || 0;
        room.pendingOjama.set(socket.id, 0);
        emitBattleOjamaPending(roomCode, room);
        if (typeof callback === 'function') callback({ success: true, count });
    });

    socket.on('leaveRoom', () => {
        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);
        if (!room) return;

        socket.leave(roomCode);
        socket.data.roomCode = undefined;
        room.players.delete(socket.id);

        if (socket.id === room.hostId) {
            io.to(roomCode).emit('roomClosed');
            rooms.delete(roomCode);
            return;
        }
        if (room.players.size === 0) {
            rooms.delete(roomCode);
            return;
        }
        emitRoomState(roomCode, room);
    });

    // プレイヤーが切断したときの処理
    socket.on('disconnect', () => {
        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);
        if (room) {
            room.players.delete(socket.id);
            if (socket.id === room.hostId) {
                io.to(roomCode).emit('roomClosed');
                rooms.delete(roomCode);
            } else if (room.players.size === 0) {
                rooms.delete(roomCode);
            } else {
                emitRoomState(roomCode, room);
            }
        }
        console.log('プレイヤーが切断しました。');
    });
});

// ポート番号3000でサーバーを起動
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`サーバーが起動しました！ http://localhost:${PORT}`);
});
