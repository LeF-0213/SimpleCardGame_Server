// 메모리 내 방 저장소
const rooms = new Map();

// 랜덤 방 ID 생성
export const generateRoomId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// 방 생성
export const createRoom = (hostSocketId) => {
  const roomId = generateRoomId();

  const room = {
    id: roomId,
    host: hostSocketId,
    guest: null,
    state: "waiting", // 'waiting', 'ready', 'playing', 'finished'
    createdAt: Date.now(),
    startedAt: null,
  };

  rooms.set(roomId, room);
  return room;
};

// 방 참가
export const joinRoom = (roomId, guestSocketId) => {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("방을 찾을 수 없습니다.");
  }

  // 이미 게스트가 있는 상태에서 동일 게스트가 재요청하면 그대로 반환
  if (room.guest && room.guest === guestSocketId) {
    return room;
  }

  // 호스트가 자신이 만든 방에 다시 join-room을 보내는 경우 대기 상태를 유지한다.
  if (room.host === guestSocketId) {
    return room;
  }

  if (room.state !== "waiting") {
    throw new Error("이미 게임이 진행 중입니다");
  }

  if (room.guest) {
    throw new Error("방이 가득 찼습니다");
  }

  room.guest = guestSocketId;
  room.state = "ready";
  room.startedAt = Date.now();

  return room;
};

// 방 조회
export const getRoom = (roomId) => {
  return rooms.get(roomId);
};

// 사용 가능한 방 목록
export const getAvailableRooms = () => {
  return Array.from(rooms.values())
    .filter((room) => room.state === "waiting")
    .map((room) => ({
      id: room.id,
      createdAt: room.createdAt,
    }));
};

// 방 개수
export const getRoomCount = () => {
  return rooms.size;
};

// 방 삭제
export const removeRoom = (roomId) => {
  rooms.delete(roomId);
};

// 비활성 방 정리
export const cleanupInactiveRooms = () => {
  const now = Date.now();
  const timeout = parseInt(process.env.INACTIVE_ROOM_TIMEOUT) || 600000;
  let cleanedCount = 0;

  for (const [roomId, room] of rooms.entries()) {
    if (room.state === "waiting" && now - room.createdAt > timeout) {
      rooms.delete(roomId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} inactive rooms`);
  }
};
