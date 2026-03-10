import React, { useRef, useEffect, useState } from 'react';
import type { WebContainer } from '@aspect/sdk';

interface TerminalProps {
  container: WebContainer | null;
}

export function Terminal({ container }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>(['WebContainer Terminal', '$ ']);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCommand = async (cmd: string) => {
    if (!container || !cmd.trim()) {
      setLines((prev) => [...prev, '$ ']);
      return;
    }

    setHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);

    const parts = cmd.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    try {
      const process = await container.spawn(command, args);
      const reader = process.output.getReader();

      const readOutput = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const outputLines = value.split('\r\n').filter((l: string) => l.length > 0);
            setLines((prev) => [...prev, ...outputLines]);
          }
        } catch {
          // stream closed
        }
      };

      await readOutput();
      const exitCode = await process.exit;
      if (exitCode !== 0) {
        setLines((prev) => [...prev, `Process exited with code ${exitCode}`]);
      }
    } catch (e: any) {
      setLines((prev) => [...prev, `Error: ${e.message}`]);
    }

    setLines((prev) => [...prev, '$ ']);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const cmd = input;
      setLines((prev) => {
        const newLines = [...prev];
        newLines[newLines.length - 1] = `$ ${cmd}`;
        return newLines;
      });
      setInput('');
      handleCommand(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx !== -1) {
        const newIdx = historyIdx + 1;
        if (newIdx >= history.length) {
          setHistoryIdx(-1);
          setInput('');
        } else {
          setHistoryIdx(newIdx);
          setInput(history[newIdx]);
        }
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      setInput('');
      setLines((prev) => [...prev, '^C', '$ ']);
    }
  };

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      style={styles.container}
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={terminalRef} style={styles.output}>
        {lines.map((line, i) => (
          <div key={i} style={styles.line}>
            {line}
          </div>
        ))}
        <div style={styles.inputLine}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={styles.input}
            autoFocus
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    background: '#1e1e1e',
    overflow: 'hidden',
    cursor: 'text',
  },
  output: {
    padding: '8px 12px',
    height: '100%',
    overflow: 'auto',
    fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
    fontSize: '13px',
    lineHeight: '1.4',
  },
  line: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    color: '#d4d4d4',
  },
  inputLine: {
    display: 'flex',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#d4d4d4',
    fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
    fontSize: '13px',
    caretColor: '#d4d4d4',
    padding: 0,
  },
};
