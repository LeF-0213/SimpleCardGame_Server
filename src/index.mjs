import { config } from "dotenv";
config(); // .env 파일 로드

import { timeStamp } from "console";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import * as roomController from "./roomControllers.mjs";
import * as signalingService from "./signalingService.mjs";

const app = express();

// Allowed Origins (환경변수에서 읽기)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : [
          "http://192.168.12.42:5173/",
          "http://localhost:5173",
          "http://localhost:5174",
          "http://localhost:5175",
          "https://development-ward-webrtc.github.io",
          // 로컬 네트워크 IP들 (필요시 .env에 추가)
      ];

console.log("Allowed Origins:", ALLOWED_ORIGINS);

// CORS 설정 함수
const corsOptions = {
    origin: function (origin, callback) {
        // 개발 중에는 모든 origin 허용 (테스트용)
        console.log("Request from origin:", origin);
        callback(null, true);

        // 프로덕션에서는 아래 코드 사용:
        // if (!origin) return callback(null, true);
        // if (ALLOWED_ORIGINS.includes(origin)) {
        //   callback(null, true);
        // } else {
        //   console.warn(`Blocked by CORS: ${origin}`);
        //   callback(new Error('Not allowed by CORS'));
        // }
    },
    credentials: true,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// HTTP 서버 생성
const server = createServer(app);

// Socket.IO 서버 설정
const io = new Server(server, {
    cors: {
        origin: true, // 개발 중에는 모든 origin 허용
        methods: ["GET", "POST"],
        credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});

// REST API 라우트
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        timeStamp: new Date().toISOString(),
        rooms: roomController.getRoomCount(),
        connections: io.engine.clientsCount,
    });
});

app.get("/api/rooms", (req, res) => {
    const rooms = roomController.getAvailableRooms();
    res.json({ rooms });
});

// WebRTC Signaling(Socket.IO)
/* 
  WebRTC Signaling은 두 Peer가 직접적인 실시간 통신연결을 수립하고 관리하기 위해 메타데이터(세션 설명 프로토콜 (SDP, Session Description Protocol), ICE 후보 (ICE Candidates), 시그널링 서버)를 교환하는 과정이다.
  WebRTC의 실제 오디오, 비디오 및 데이터 전송은 P2P 방식으로 이루어지지만, 
  이 P2P 방식을 시작하고 설정하기 위해서는 별도의 중개 서버를 위해 시그널링이 반드시 필요하다.

  연결 과정 요약
  1. 연결 요청: 피어 A가 시그널링 서버에 접속합니다.
  2. Offer 생성: 피어 A가 자신의 SDP Offer를 생성합니다.
  3. Offer 전달: 피어 A가 시그널링 서버를 통해 피어 B에게 SDP Offer를 보냅니다.
  4. Answer 생성: 피어 B가 Offer를 받고 자신의 SDP Answer를 생성하여 서버를 통해 A에게 다시 보냅니다.
  5. ICE 교환: 두 Peer는 동시에 자신들의 ICE Candidate 정보를 서버를 통해 서로 교환합니다.
  6/ P2P 연결 수립: ICE Candidate 교환을 통해 최적의 경로(STUN/TURN 서버 포함)가 결정되면, 두 피어는 시그널링 서버를 떠나 직접적인 P2P 데이터 채널을 통해 통신을 시작합니다.
*/
io.on("connection", (socket) => {
    console.log(`[${socket.id}] Client connected`);

    socket.on("error", (err) => {
        console.log(`[${socket.id}] socket error:`, err);
    });

    // 방 생성
    socket.on("create-room", () => {
        const room = roomController.createRoom(socket.id);
        socket.join(room.id);
        socket.roomId = room.id;
        socket.emit("room-created", { roomId: room.id });
        console.log(`[${socket.id}] Created room: ${room.id}`);
    });

    // 방 목록 요청
    socket.on("get-rooms", () => {
        const rooms = roomController.getAvailableRooms();
        console.log(rooms);
        socket.emit("room-list", { rooms });
    });

    // 방 참가
    socket.on("join-room", ({ roomId }) => {
        try {
            const room = roomController.joinRoom(roomId, socket.id);
            socket.join(roomId);
            socket.roomId = roomId;

            socket.emit("room-joined", { roomId, isHost: false });
            io.to(room.host).emit("guest-joined", {
                guestId: socket.id,
            });

            console.log(`[${socket.id}] Joined room: ${roomId}`);
        } catch (error) {
            socket.emit("error", { message: error.message });
        }
    });

    socket.on("game-init", (payload) => {
        console.log("server received game-init payload:", payload);
        const { roomId, state } = payload || {};
        console.log("Relay game-init for room", roomId);
        io.to(roomId).emit("game-init", { state });
    });

    // 게스트가 초기 상태를 요청하면 호스트에게 전달
    socket.on("request-game-init", ({ roomId, requester, retry }) => {
        const room = roomController.getRoom(roomId);
        if (!room) return;
        const hostId = room.host;
        if (hostId) {
            io.to(hostId).emit("request-game-init", { from: socket.id, requester, retry: !!retry });
        }
    });

    // WebRTC Offer
    socket.on("offer", ({ roomId, offer }) => {
        signalingService.handleOffer(io, socket, roomId, offer);
    });

    // WebRTC Answer
    socket.on("answer", ({ roomId, answer }) => {
        signalingService.handleAnswer(io, socket, roomId, answer);
    });

    // ICE Candidate
    socket.on("ice-candidate", ({ roomId, candidate }) => {
        signalingService.handleIceCandidate(io, socket, roomId, candidate);
    });

    // 게임 종료 (기록하지 않고 방만 정리)
    socket.on("game-end", ({ roomId }) => {
        const room = roomController.getRoom(roomId);
        if (room) {
            io.to(roomId).emit("game-ended");
            roomController.removeRoom(roomId);
        }
    });

    // 연결 해제
    socket.on("disconnect", (reason) => {
        console.log(`[${socket.id}] Client disconnected: ${reason}`);

        const roomId = socket.roomId;
        if (roomId) {
            const room = roomController.getRoom(roomId);
            if (room) {
                const otherId = room.host === socket.id ? room.guest : room.host;
                if (otherId) {
                    io.to(otherId).emit("opponent-disconnected");
                }

                // 방 삭제
                roomController.removeRoom(roomId);
                console.log(`[${roomId}] Room closed due to disconnect`);
            }
        }
    });

    // 방 나가기
    socket.on("leave-room", ({ roomId }) => {
        const room = roomController.getRoom(roomId);
        if (room) {
            const otherId = room.host === socket.id ? room.guest : room.host;
            if (otherId) {
                io.to(otherId).emit("opponent-left");
            }

            roomController.removeRoom(roomId);
            socket.leave(roomId);
            delete socket.roomId;
            console.log(`[${socket.id}] Left room: ${roomId}`);
        }
    });
});

// 주기적 방 정리
setInterval(() => {
    roomController.cleanupInactiveRooms();
}, parseInt(process.env.ROOM_CLEANUP_INTERVAL) || 300000);

// 서버 시작
const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
    console.log("=================================");
    console.log("🎮 TCG WebRTC Server Running");
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌐 Client URL: ${process.env.CLIENT_URL}`);
    console.log("=================================");
});

// Graceful shutdown
process.on("SIGTERM", () => {
    console.log("SIGTERM received, closing server...");
    server.close(() => {
        console.log("Server closed");
        process.exit(0); // 0는 성공, 1은 실패를 의미
    });
});
