import { io } from "socket.io-client";

export const socket = io("https://mendikot-server.onrender.com", {
  autoConnect: true,
});