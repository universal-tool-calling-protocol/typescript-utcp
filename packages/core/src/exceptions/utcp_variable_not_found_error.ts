export class UtcpVariableNotFoundError extends Error {
  public variableName: string;

  /**
   * Initializes the exception with the missing variable name.
   * 
   * @param variableName The name of the variable that could not be found.
   */
  constructor(variableName: string) {
    super(
      `Variable '${variableName}' referenced in call template configuration not found. ` +
      `Please ensure it's defined in client.config.variables, environment variables, or a configured variable loader.`
    );
    this.variableName = variableName;
    this.name = 'UtcpVariableNotFoundError';
  }
}