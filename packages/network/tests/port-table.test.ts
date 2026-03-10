import { describe, it, expect, vi } from 'vitest';
import { PortTable } from '../src/port-table.js';

describe('PortTable', () => {
  it('should bind and lookup ports', () => {
    const table = new PortTable();
    const channel = new MessageChannel();
    table.bind(3000, 1, channel.port1);
    const handler = table.lookup(3000);
    expect(handler).toBe(channel.port1);
    channel.port1.close();
    channel.port2.close();
  });

  it('should return null for unbound ports', () => {
    const table = new PortTable();
    expect(table.lookup(3000)).toBeNull();
  });

  it('should throw for duplicate port binding', () => {
    const table = new PortTable();
    const channel = new MessageChannel();
    table.bind(3000, 1, channel.port1);
    expect(() => table.bind(3000, 2, channel.port2)).toThrow();
    channel.port1.close();
    channel.port2.close();
  });

  it('should unbind ports', () => {
    const table = new PortTable();
    const channel = new MessageChannel();
    table.bind(3000, 1, channel.port1);
    table.unbind(3000);
    expect(table.lookup(3000)).toBeNull();
    channel.port1.close();
    channel.port2.close();
  });

  it('should emit events on bind/unbind', () => {
    const table = new PortTable();
    const bindCb = vi.fn();
    const unbindCb = vi.fn();
    table.on('bind', bindCb);
    table.on('unbind', unbindCb);

    const channel = new MessageChannel();
    table.bind(3000, 1, channel.port1);
    expect(bindCb).toHaveBeenCalledWith(3000);

    table.unbind(3000);
    expect(unbindCb).toHaveBeenCalledWith(3000);
    channel.port1.close();
    channel.port2.close();
  });

  it('should list all bound ports', () => {
    const table = new PortTable();
    const ch1 = new MessageChannel();
    const ch2 = new MessageChannel();
    table.bind(3000, 1, ch1.port1);
    table.bind(8080, 2, ch2.port1);
    const ports = table.list();
    expect(ports).toContain(3000);
    expect(ports).toContain(8080);
    ch1.port1.close(); ch1.port2.close();
    ch2.port1.close(); ch2.port2.close();
  });

  it('should unbind all ports for a pid', () => {
    const table = new PortTable();
    const ch1 = new MessageChannel();
    const ch2 = new MessageChannel();
    table.bind(3000, 1, ch1.port1);
    table.bind(3001, 1, ch2.port1);
    table.unbindByPid(1);
    expect(table.size).toBe(0);
    ch1.port1.close(); ch1.port2.close();
    ch2.port1.close(); ch2.port2.close();
  });
});
