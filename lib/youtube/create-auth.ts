/** Login is needed only when writing to YouTube, not for demo playlist creation. */
export function needsGoogleSignIn(signedIn: boolean, demoMode: boolean): boolean {
  return !signedIn && !demoMode
}
