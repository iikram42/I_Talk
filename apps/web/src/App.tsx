import { Route, Routes } from 'react-router';
import { ToastProvider } from './components/ui/Toast';
import { CreateRoomPage } from './pages/CreateRoomPage';
import { HomePage } from './pages/HomePage';
import { JoinRoomPage } from './pages/JoinRoomPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RoomPage } from './pages/RoomPage';

export function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/new" element={<CreateRoomPage />} />
        <Route path="/join/:roomId" element={<JoinRoomPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ToastProvider>
  );
}
