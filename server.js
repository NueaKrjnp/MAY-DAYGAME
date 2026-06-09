const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// เก็บข้อมูลห้องทั้งหมดที่ถูกสร้างขึ้น
let rooms = {}; 
/* โครงสร้างข้อมูลห้อง:
rooms[roomCode] = {
    maxPlayers: 5,        // จำนวนผู้เล่นที่เลือกไว้ (4-6 คน)
    planePosition: 0,
    planeAltitude: 2,
    map: Array(60).fill(null),
    players: {}           // { socketId: { name: '', role: '' } }
}
*/

// ฟังก์ชันสุ่มบทบาทตามจำนวนคนในห้อง
function assignRolesForRoom(room) {
    const ids = Object.keys(room.players);
    const count = room.maxPlayers;
    let roles = [];

    // จัดเซ็ตบทบาทให้สมดุลตามจำนวนคน
    if (count === 4) {
        roles = ['Terrorist', 'Pilot', 'Pilot', 'ATC_Good']; // ไม่มี Spy
    } else if (count === 5) {
        roles = ['Terrorist', 'Pilot', 'Pilot', 'ATC_Good', 'ATC_Spy']; // สูตรมาตรฐาน
    } else if (count === 6) {
        roles = ['Terrorist', 'Pilot', 'Pilot', 'ATC_Good', 'ATC_Good', 'ATC_Spy']; // เพิ่ม ATC คนดีอีกคน
    }

    // สุ่มสลับตำแหน่งบทบาท
    roles.sort(() => Math.random() - 0.5);

    // แจกจ่ายบทบาทให้ผู้เล่นทุกคนในห้อง
    ids.forEach((id, index) => {
        room.players[id].role = roles[index] || 'Spectator';
    });
}

io.on('connection', (socket) => {
    
    // 1. ระบบสร้างเซิร์ฟเวอร์ (สร้างห้อง)
    socket.on('createRoom', (data) => {
        const { playerName, maxPlayers } = data;
        // สุ่มรหัสห้องเป็นตัวเลข 4 หลัก
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString(); 
        
        rooms[roomCode] = {
            maxPlayers: parseInt(maxPlayers),
            planePosition: 0,
            planeAltitude: 2,
            map: Array(60).fill(null),
            players: {}
        };

        // ให้คนสร้างห้องเข้าร่วมห้องทันที
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = { name: playerName, role: '' };
        
        // ส่งรหัสห้องกลับไปให้คนสร้าง
        socket.emit('roomCreated', { roomCode, maxPlayers });
        updateRoomPlayers(roomCode);
    });

    // 2. ระบบเข้าร่วมเซิร์ฟเวอร์ด้วยรหัสผ่าน
    socket.on('joinRoom', (data) => {
        const { playerName, roomCode } = data;
        const room = rooms[roomCode];

        if (!room) {
            socket.emit('errorMsg', '❌ ไม่พบรหัสห้องนี้ กรุณาตรวจสอบอีกครั้ง');
            return;
        }

        const currentPlayersCount = Object.keys(room.players).length;
        if (currentPlayersCount >= room.maxPlayers) {
            socket.emit('errorMsg', '❌ ห้องนี้เต็มแล้ว!');
            return;
        }

        // เข้าร่วมห้องสำเร็จ
        socket.join(roomCode);
        room.players[socket.id] = { name: playerName, role: '' };

        // ถ้าคนเข้ามาครบตามที่กำหนดไว้ ให้เริ่มเกมและสุ่มบทบาททันที!
        if (Object.keys(room.players).length === room.maxPlayers) {
            assignRolesForRoom(room);
            io.to(roomCode).emit('gameStart', '🔥 คนครบแล้ว! ระบบสุ่มบทบาทเสร็จสิ้น เริ่มเกม!');
        }

        updateRoomPlayers(roomCode);
    });

    // 3. ระบบควบคุมการบิน (เหมือนเดิมแต่แยกตามห้อง)
    socket.on('playFlightCard', (data) => {
        const { roomCode, cardType } = data;
        const room = rooms[roomCode];
        if (!room) return;

        if (room.players[socket.id].role === 'Pilot') {
            if (cardType === 'Climb' && room.planeAltitude < 3) room.planeAltitude++;
            if (cardType === 'Descend' && room.planeAltitude > 1) room.planeAltitude--;
            
            room.planePosition++;

            const currentTile = room.map[room.planePosition];
            if (currentTile && currentTile.altitude === room.planeAltitude) {
                io.to(roomCode).emit('gameEvent', `💥 ชนอุปสรรคที่ระดับ ${room.planeAltitude}! เกมจบ ผู้ก่อการร้ายชนะ`);
            } else if (room.planePosition >= 59 && room.planeAltitude === 1 && cardType === 'Landing') {
                io.to(roomCode).emit('gameEvent', '🎉 ลงจอดสำเร็จ! ฝั่งนักบินและ ATC ชนะ!');
            } else {
                updateRoomPlayers(roomCode);
            }
        }
    });

    // ฟังก์ชันส่งข้อมูลอัปเดตหน้าจอแยกตามบทบาทในห้องนั้นๆ
    function updateRoomPlayers(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        Object.keys(room.players).forEach(id => {
            const role = room.players[id].role;
            let maskedMap = [...room.map];

            // 🔒 ซ่อนข้อมูลอุปสรรคไม่ให้ Pilot และ Spy เห็น
            if (role === 'Pilot' || role === 'ATC_Spy') {
                maskedMap = room.map.map((tile) => {
                    return tile ? { type: '?', altitude: '?' } : null;
                });
            }

            io.to(id).emit('gameStateUpdate', {
                role: role,
                planePosition: room.planePosition,
                planeAltitude: room.planeAltitude,
                map: maskedMap,
                playersList: Object.values(room.players).map(p => `${p.name} (${p.role || 'กำลังรอ...'})`)
            });
        });
    }
});

http.listen(3000, () => console.log('🚀 เซิร์ฟเวอร์เกมรันแล้วที่พอร์ต 3000'));