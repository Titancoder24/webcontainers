import React from 'react';

interface FileTreeProps {
  files: string[];
  selectedFile: string | null;
  onSelect: (filename: string) => void;
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return '📄';
    case 'ts':
    case 'tsx':
      return '📘';
    case 'json':
      return '📋';
    case 'css':
      return '🎨';
    case 'html':
      return '🌐';
    case 'md':
      return '📝';
    default:
      return '📄';
  }
}

export function FileTree({ files, selectedFile, onSelect }: FileTreeProps) {
  return (
    <div style={styles.container}>
      {files.map((file) => (
        <div
          key={file}
          style={{
            ...styles.item,
            ...(file === selectedFile ? styles.selected : {}),
          }}
          onClick={() => onSelect(file)}
        >
          <span style={styles.icon}>{getFileIcon(file)}</span>
          <span style={styles.name}>{file}</span>
        </div>
      ))}
      {files.length === 0 && (
        <div style={styles.empty}>No files</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '4px 0',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    userSelect: 'none',
  },
  selected: {
    background: '#094771',
    color: '#fff',
  },
  icon: {
    marginRight: '6px',
    fontSize: '14px',
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: {
    padding: '12px',
    color: '#666',
    fontSize: '12px',
    textAlign: 'center',
  },
};
