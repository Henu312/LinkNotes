const isBrokenPipeError = (error: unknown): boolean => {
  const candidate = error as NodeJS.ErrnoException | undefined;
  return candidate?.code === 'EPIPE';
};

const writeSafely = (stream: NodeJS.WriteStream, message: string): void => {
  try {
    stream.write(`${message}\n`);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  }
};

export const installIoErrorGuards = (): void => {
  const swallowBrokenPipe = (error: Error): void => {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  };

  process.stdout.on('error', swallowBrokenPipe);
  process.stderr.on('error', swallowBrokenPipe);
};

export const safeLog = (...parts: unknown[]): void => {
  writeSafely(process.stdout, parts.map((part) => String(part)).join(' '));
};

export const safeError = (...parts: unknown[]): void => {
  writeSafely(process.stderr, parts.map((part) => String(part)).join(' '));
};
