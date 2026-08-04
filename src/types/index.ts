export type Game = {
  id: string;
  courtId: string;
  courtName: string;
  distance: string;
  time: string;
  date: string;
  currentPlayers: number;
  maxPlayers: number;
  isPublic: boolean;
};

export type Court = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  activeGameIds: string[];
};

export type User = {
  id: string;
  username: string;
  email: string;
  gamesHosted: number;
  gamesJoined: number;
  avatarInitials: string;
};
