import * as roomController from "./roomControllers.mjs";

// WebRTC Offer 처리
export const handleOffer = (io, socket, roomId, offer) => {
  const room = roomController.getRoom(roomId);

  if (!room) {
    socket.emit("error", { message: "방을 찾을 수 없습니다" });
    return;
  }

  console.log(`[${socket.id}] Sending offer to room: ${roomId}`);

  const targetId = socket.id === room.host ? room.guest : room.host;

  // 상대방에게 전달
  if (targetId) {
    io.to(targetId).emit("offer", {
      offer,
      from: socket.id,
    });
  }
};

// WebRTC Answer 처리
export const handleAnswer = (io, socket, roomId, answer) => {
  const room = roomController.getRoom(roomId);

  if (!room) {
    socket.emit("error", { message: "방을 찾을 수 없습니다" });
    return;
  }

  console.log(`[${socket.id}] Sending answer to room: ${roomId}`);

  const targetId = socket.id === room.host ? room.guest : room.host;

  if (targetId) {
    io.to(targetId).emit("answer", {
      answer,
      from: socket.id,
    });
  }
};

// ICE Candidate 처리
export const handleIceCandidate = (io, socket, roomId, candidate) => {
  const room = roomController.getRoom(roomId);

  if (!room) {
    return;
  }

  const targetId = socket.id === room.host ? room.guest : room.host;

  if (targetId) {
    io.to(targetId).emit("ice-candidate", {
      candidate,
      from: socket.id,
    });
  }
};

// 연결 상태 브로드캐스트
export const broadcastConnectionState = (io, roomId, socketId, state) => {
  io.to(roomId).emit("peer-connection-state", {
    peerId: socketId,
    state,
  });
};
