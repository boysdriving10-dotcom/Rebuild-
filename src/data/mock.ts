import type { Court, Game, User } from '@/types';

/** Default map region — Brooklyn, NY */
export const DEFAULT_REGION = {
  latitude: 40.6782,
  longitude: -73.9442,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

export const MOCK_USER: User = {
  id: 'user-1',
  username: 'hooper22',
  email: 'hooper@ballout.app',
  bio: 'Ready to ball.',
  gamesHosted: 0,
  gamesJoined: 0,
  avatarInitials: 'H2',
};

export const MOCK_COURTS: Court[] = [
  {
    id: 'court-1',
    name: 'Rucker Park',
    latitude: 40.8298,
    longitude: -73.9365,
    address: '155th St & Frederick Douglass Blvd, New York, NY',
    activeGameIds: ['game-1', 'game-2'],
  },
  {
    id: 'court-2',
    name: 'West 4th Street Courts',
    latitude: 40.7312,
    longitude: -74.0011,
    address: 'W 4th St & 6th Ave, New York, NY',
    activeGameIds: ['game-3'],
  },
  {
    id: 'court-3',
    name: 'McCarren Park Courts',
    latitude: 40.7214,
    longitude: -73.9522,
    address: '776 Lorimer St, Brooklyn, NY',
    activeGameIds: [],
  },
  {
    id: 'court-4',
    name: 'Brooklyn Bridge Park Courts',
    latitude: 40.6993,
    longitude: -73.9972,
    address: 'Pier 2, Brooklyn Bridge Park, Brooklyn, NY',
    activeGameIds: ['game-4'],
  },
  {
    id: 'court-5',
    name: 'Maria Hernandez Park',
    latitude: 40.7036,
    longitude: -73.9245,
    address: 'Knickerbocker Ave & Starr St, Brooklyn, NY',
    activeGameIds: [],
  },
  {
    id: 'court-6',
    name: 'Dean Street Playground',
    latitude: 40.6798,
    longitude: -73.9581,
    address: 'Dean St & Underhill Ave, Brooklyn, NY',
    activeGameIds: ['game-5'],
  },
  {
    id: 'court-7',
    name: "St. John's Recreation Center",
    latitude: 40.6742,
    longitude: -73.9367,
    address: '1251 Prospect Pl, Brooklyn, NY',
    activeGameIds: [],
  },
  {
    id: 'court-8',
    name: 'Prospect Park Ballfields',
    latitude: 40.6602,
    longitude: -73.969,
    address: 'Prospect Park, Brooklyn, NY',
    activeGameIds: ['game-6', 'game-7'],
  },
];

export const MOCK_GAMES: Game[] = [];

export function getGamesForCourt(courtId: string): Game[] {
  return MOCK_GAMES.filter((game) => game.courtId === courtId);
}

export function getCourtById(courtId: string): Court | undefined {
  return MOCK_COURTS.find((court) => court.id === courtId);
}

export function searchCourts(query: string): Court[] {
  const q = query.trim().toLowerCase();
  if (!q) return MOCK_COURTS;
  return MOCK_COURTS.filter(
    (court) =>
      court.name.toLowerCase().includes(q) || court.address.toLowerCase().includes(q)
  );
}
