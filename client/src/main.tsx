import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// No StrictMode: its double-run of effects in development joined every room twice and left a ghost seat
// behind for the reconnection window. The app has no other use for it.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
