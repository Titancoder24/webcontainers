import React, { useState, useCallback } from 'react';

interface PreviewProps {
  url: string | null;
}

export function Preview({ url }: PreviewProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (!url) {
    return (
      <div style={styles.placeholder}>
        <p style={styles.placeholderText}>No server running</p>
        <p style={styles.placeholderHint}>
          Start a server to see the preview here
        </p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.urlBar}>
        <button onClick={handleRefresh} style={styles.refreshBtn}>
          ↻
        </button>
        <div style={styles.urlInput}>{url}</div>
      </div>
      <iframe
        key={refreshKey}
        src={url}
        style={styles.iframe}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Preview"
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  urlBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    background: '#2d2d2d',
    borderBottom: '1px solid #3c3c3c',
    gap: '6px',
  },
  refreshBtn: {
    background: 'none',
    border: '1px solid #555',
    borderRadius: '3px',
    color: '#d4d4d4',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '2px 6px',
    lineHeight: 1,
  },
  urlInput: {
    flex: 1,
    background: '#3c3c3c',
    borderRadius: '3px',
    padding: '3px 8px',
    fontSize: '12px',
    color: '#aaa',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  iframe: {
    flex: 1,
    border: 'none',
    background: '#fff',
    width: '100%',
  },
  placeholder: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1e1e1e',
  },
  placeholderText: {
    fontSize: '14px',
    color: '#888',
    marginBottom: '8px',
  },
  placeholderHint: {
    fontSize: '12px',
    color: '#555',
  },
};
