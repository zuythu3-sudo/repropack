process.stdout.write("Checking synthetic project\n");
process.stderr.write("Authorization: Bearer demo-token-123456\n");
process.stderr.write(`Workspace: ${process.cwd()}\n`);
process.stderr.write("Error: synthetic fixture failed\n");
process.exitCode = 7;
