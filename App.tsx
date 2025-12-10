import React from 'react';
import { Spectrogram } from './components/Spectrogram';

const App: React.FC = () => {
  return (
    <div className="w-screen h-screen bg-transparent flex flex-col justify-end">
      {/* The entire app container is transparent to allow OBS overlay */}
      <Spectrogram />
    </div>
  );
};

export default App;