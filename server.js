const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// ✅ ส่วนสำคัญ: คำสั่งที่ทำให้ Render ยอมเปิดหน้าเว็บ index.html ให้เรา
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let rooms = {}; 

function assignRolesForRoom(room) {
    const ids = Object.keys(room.players);
    const count = room.maxPlayers;
    let roles = [];

    if (count === 4) {
        roles = ['Terrorist', 'Pilot', 'Pilot', 'ATC_Good'];
    } else if (count === 5) {
        roles = ['Terrorist', 'Pilot', 'Pilot', 'ATC_Good', 'ATC_Spy'];
    } else if (count === 6) {
        roles = ['Terrorist', 'Pilot', 'Pilot', 'ATC_Good', 'ATC_Good', 'ATC_Spy'];
    }

    roles.sort(() => Math.random() - 0.5);

    ids.forEach((id, index) => {
        room.players[id].role = roles[index] || 'Spectator';
    });
}

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => {
        const { playerName, maxPlayers } = data;
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString(); 
        
        rooms[roomCode] = {
            maxPlayers: parseInt(maxPlayers),
            planePosition: 0,
            planeAltitude: 2,
            map: Array(60).fill(null),
            players: {}
        };

        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = { name: playerName, role: '' };
        socket.emit('roomCreated', { roomCode, maxPlayers });
        updateRoomPlayers(roomCode);
    });

    socket.on('joinRoom', (data) => {
        const { playerName, roomCode } = data;
        const room = rooms[roomCode];

        if (!room) {
            socket.emit('errorMsg', '❌ ไม่พบรหัสห้องนี้');
            return;
        }

        if (Object.keys(room.players).length >= room.maxPlayers) {
            socket.emit('errorMsg', '❌ ห้องเต็มแล้ว');
            return;
        }

        socket.join(roomCode);
        room.players[socket.id] = { name: playerName, role: '' };

        if (Object.keys(room.players).length === room.maxPlayers) {
            assignRolesForRoom(room);
            io.to(roomCode).emit('gameStart', '🔥 คนครบแล้ว! เริ่มสุ่มบทบาท!');
        }

        updateRoomPlayers(roomCode);
    });

    socket.on('playFlightCard', (data) => {
        const { roomCode, cardType } = data;
        const room = rooms[roomCode];
        if (!room) return;

        if (room.players[socket.id].role === 'Pilot') {
            if (cardType === 'Climb' && room.planeAltitude < 3) room.planeAltitude++;
            if (cardType === 'Descend' && room.planeAltitude > 1) room.planeAltitude--;
            
            room.planePosition++;

            if (room.planePosition >= 59 && room.planeAltitude === 1 && cardType === 'Landing') {
                io.to(roomCode).emit('gameEvent', '🎉 ลงจอดสำเร็จ! ฝั่งนักบินชนะ!');
            } else {
                updateRoomPlayers(roomCode);
            }
        }
    });

    function updateRoomPlayers(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        Object.keys(room.players).forEach(id => {
            const role = room.players[id].role;
            let maskedMap = [...room.map];
            if (role === 'Pilot' || role === 'ATC_Spy') {
                maskedMap = room.map.map(() => ({ type: '?', altitude: '?' }));
            }
            io.to(id).emit('gameStateUpdate', {
                role: role,
                planePosition: room.planePosition,
                planeAltitude: room.planeAltitude,
                map: maskedMap,
                playersList: Object.values(room.players).map(p => `${p.name} (${p.role || 'รอ...'})`)
            });
        });
    }
});

// ✅ ส่วนสำคัญ: ใช้เลขพอร์ตที่ Render กำหนดให้
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));