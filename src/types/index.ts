export type Game = {
  id: string;
  courtId: string;
  courtName: string;
  courtLatitude: number;
  courtLongitude: number;
  courtAddress: string;
  distance: string;
  time: string;
  date: string;
  currentPlayers: number;
  maxPlayers: number;
  isPublic: boolean;
  hostId: string;
  hostUsername: string;
  playerIds: string[];
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
  bio: string;
  gamesHosted: number;
  gamesJoined: number;
  avatarInitials: string;
};

export type CreateGameInput = {
  courtId: string;
  courtName: string;
  courtLatitude: number;
  courtLongitude: number;
  courtAddress: string;
  date: string;
  time: string;
  maxPlayers: number;
  isPublic: boolean;
};
