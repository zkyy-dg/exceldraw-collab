// Shared types between client and server (duplicated for now; extract to shared package later)
export type CollabUser = {
  socketId: string;
  username: string;
};
