# General Project Rules

## General Rules
* The `/docs` folder in the repository is the knowledge base for this project. It holds all the information needed for the work. When in doubt, `/docs` is the source of truth.
* Always check that the task we are doing makes sense with respect to the instructions in `/docs`.
* Do not read the files listed in `.gitignore`.
* We need to generate the system we will work on. There is no "initial system" to download from any repository.
* If new folders appear in the repository, ask for their purpose before working with them.
* Make sure to use synthetic data for everything.

## Conversation Recording
* Every time a new conversation with the LLM starts, ask whether the conversation should be recorded. Do this with no exceptions.
* If the answer is yes:
  * Ask which sprint of the project we are in.
  * Record every interaction in `/conversations/Sprint<number>/<CurrentDate>`.
  * Record each interaction in this format:

    ## User prompt:
    <Report_User_Prompt>

    ## AI Reply
    <Report_AI_Reply>

## Coding Standards
* Keep the code as simple as possible. Do not rely on complex patterns. The product needs to be functional, but it does not need to be a "real product."
* Use synthetic data for everything. 

## Best Practice
* Remind me to pull from the main branch before pushing.
* Update the AGENTS.md, CLAUDE.md file for important changes made to the project.
