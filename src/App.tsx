import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ExplorerLayout } from './explorer/ExplorerLayout';
import { entities } from './registry';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Navigate to='/documents' replace />} />
        {entities.flatMap(entity => [
          <Route
            key={entity.id}
            path={entity.routeBase}
            element={<ExplorerLayout entity={entity} />}
          />,
          ...entity.detailPaths.map(path => (
            <Route
              key={`${entity.id}:${path}`}
              path={`${entity.routeBase}/${path}`}
              element={<ExplorerLayout entity={entity} />}
            />
          )),
        ])}
        <Route
          path='*'
          element={
            <main className='startup'>
              <h1>Page not found</h1>
              <a className='button' href='/documents'>
                Open document library
              </a>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
