import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/layout/Navbar';
import { HomePage } from './pages/HomePage';
import { UploadPage } from './pages/UploadPage';
import { PresenterPage } from './pages/PresenterPage';
import { JoinPage } from './pages/JoinPage';
import { ViewerPage } from './pages/ViewerPage';
import { MyPresentationsPage } from './pages/MyPresentationsPage';
import { PresentationDetailPage } from './pages/PresentationDetailPage';

function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/my-presentations" element={<MyPresentationsPage />} />
        <Route path="/presentation/:presentationId" element={<PresentationDetailPage />} />
        <Route path="/present/:presentationId" element={<PresenterPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/view/:presentationId" element={<ViewerPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;


