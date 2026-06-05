// Populates the database with sample rows so the prototype has something to show.
// Run with: npm run seed
import { db, migrate } from './index.js';

migrate();

const sample = [
  { title: 'Midnight Static', artist: 'The Calico Cats', album: 'Night Frequencies' },
  { title: 'Coastal Drift', artist: 'Marisol Vega', album: 'Tideline' },
  { title: 'Paper Radio', artist: 'Foxglove', album: 'Analog Hearts' },
  { title: 'Slow Sunday', artist: 'The Calico Cats', album: 'Night Frequencies' },
];

db.exec('DELETE FROM tracks;');
const insert = db.prepare('INSERT INTO tracks (title, artist, album) VALUES (?, ?, ?)');
for (const t of sample) insert.run(t.title, t.artist, t.album);

console.log(`Seeded ${sample.length} tracks into the database.`);
