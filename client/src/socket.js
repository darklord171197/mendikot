import { io } from "socket.io-client";

export const socket = io("https://mendikot.onrender.com", {
  autoConnect: true,
  transports: ["websocket", "polling"],
});