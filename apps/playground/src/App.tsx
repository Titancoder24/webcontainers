import React, { useEffect, useRef, useState, useCallback } from 'react';
import { WebContainer } from '@aspect/sdk';
import type { FileSystemTree } from '@aspect/sdk';
import { FileTree } from './components/FileTree.js';
import { Editor } from './components/Editor.js';
import { Terminal } from './components/Terminal.js';
import { Preview } from './components/Preview.js';

const DEFAULT_FILES: FileSystemTree = {
  'package.json': {
    file: {
      contents: JSON.stringify(
        {
          name: 'example-app',
          version: '1.0.0',
          scripts: {
            start: 'node index.js',
          },
          dependencies: {
            express: '^4.18.0',
          },
        },
        null,
        2
      ),
    },
  },
  'index.js': {
    file: {
      contents: `const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('<h1>Hello from WebContainer!</h1><p>This server is running entirely in your browser.</p>');
});

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}\`);
});
`,
    },
  },
};

export function App() {
  const [container, setContainer] = useState<WebContainer | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>('index.js');
  const [fileContent, setFileContent] = useState<string>('');
  const [files, setFiles] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [leftWidth, setLeftWidth] = useState(200);
  const [bottomHeight, setBottomHeight] = useState(300);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const wc = await WebContainer.boot();
        if (!mounted) return;

        await wc.mount(DEFAULT_FILES);

        wc.on('server-ready', (port, url) => {
          if (mounted) setPreviewUrl(url);
        });

        setContainer(wc);
        setBooting(false);

        // Load file list
        const entries = (await wc.fs.readdir('/home/project')) as string[];
        setFiles(entries);

        // Load default file
        const content = await wc.fs.readFile('/home/project/index.js', 'utf-8');
        setFileContent(content as string);
      } catch (e) {
        console.error('Boot failed:', e);
        setBooting(false);
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  const handleFileSelect = useCallback(
    async (filename: string) => {
      if (!container) return;
      setSelectedFile(filename);
      try {
        const content = await container.fs.readFile(`/home/project/${filename}`, 'utf-8');
        setFileContent(content as string);
      } catch (e) {
        console.error('Failed to read file:', e);
      }
    },
    [container]
  );

  const handleFileChange = useCallback(
    async (content: string) => {
      if (!container || !selectedFile) return;
      setFileContent(content);
      try {
        await container.fs.writeFile(`/home/project/${selectedFile}`, content);
      } catch (e) {
        console.error('Failed to write file:', e);
      }
    },
    [container, selectedFile]
  );

  if (booting) {
    return (
      <div style={styles.bootScreen}>
        <div style={styles.bootSpinner} />
        <p style={styles.bootText}>Booting WebContainer...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Top section */}
      <div style={styles.topSection}>
        {/* File Tree */}
        <div style={{ ...styles.fileTree, width: leftWidth }}>
          <div style={styles.panelHeader}>FILES</div>
          <FileTree
            files={files}
            selectedFile={selectedFile}
            onSelect={handleFileSelect}
          />
        </div>

        {/* Resize handle */}
        <div
          style={styles.resizeHandleV}
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startWidth = leftWidth;
            const onMove = (ev: MouseEvent) => {
              setLeftWidth(Math.max(120, Math.min(400, startWidth + ev.clientX - startX)));
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        />

        {/* Editor */}
        <div style={styles.editor}>
          <div style={styles.panelHeader}>
            {selectedFile ? selectedFile.toUpperCase() : 'EDITOR'}
          </div>
          <Editor
            content={fileContent}
            filename={selectedFile}
            onChange={handleFileChange}
          />
        </div>

        {/* Preview */}
        <div style={styles.preview}>
          <div style={styles.panelHeader}>PREVIEW</div>
          <Preview url={previewUrl} />
        </div>
      </div>

      {/* Resize handle */}
      <div
        style={styles.resizeHandleH}
        onMouseDown={(e) => {
          const startY = e.clientY;
          const startHeight = bottomHeight;
          const onMove = (ev: MouseEvent) => {
            setBottomHeight(
              Math.max(100, Math.min(600, startHeight - (ev.clientY - startY)))
            );
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      />

      {/* Terminal */}
      <div style={{ ...styles.terminal, height: bottomHeight }}>
        <div style={styles.panelHeader}>TERMINAL</div>
        <Terminal container={container} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#1e1e1e',
  },
  topSection: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  fileTree: {
    background: '#252526',
    borderRight: '1px solid #3c3c3c',
    overflow: 'auto',
    flexShrink: 0,
  },
  editor: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRight: '1px solid #3c3c3c',
  },
  preview: {
    width: '35%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  terminal: {
    background: '#1e1e1e',
    borderTop: '1px solid #3c3c3c',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  panelHeader: {
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.5px',
    color: '#888',
    background: '#252526',
    borderBottom: '1px solid #3c3c3c',
    userSelect: 'none',
  },
  resizeHandleV: {
    width: '4px',
    cursor: 'col-resize',
    background: 'transparent',
    flexShrink: 0,
  },
  resizeHandleH: {
    height: '4px',
    cursor: 'row-resize',
    background: 'transparent',
    flexShrink: 0,
  },
  bootScreen: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#1e1e1e',
    color: '#d4d4d4',
  },
  bootSpinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #3c3c3c',
    borderTopColor: '#007acc',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '16px',
  },
  bootText: {
    fontSize: '14px',
    color: '#888',
  },
};
