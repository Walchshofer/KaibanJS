![AgenticJS Logo](https://www.agenticjs.com/logo.svg)

AgenticJS is a JavaScript-native framework for building and managing multi-agent systems.

[![Star on GitHub](https://img.shields.io/github/stars/AI-Champions/agenticjs.svg?style=social)](https://github.com/AI-Champions/AgenticJS)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/AI-Champions/agenticjs/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/agenticjs.svg?style=flat)](https://www.npmjs.com/package/agenticjs)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/AI-Champions/AgenticJS/pulls)


**Powered by Claude**

AgenticJS utilizes [Claude](https://www.anthropic.com/api), the cutting-edge LLM from [Anthropic](https://www.anthropic.com/), across all examples. This integration allows AgenticJS to offer advanced AI agent functionalities and decision-making capabilities, making every interaction smarter. Discover how we use Claude to bring innovative AI solutions to life in our [interactive playground](https://agenticjs.com).

## Try It Out

[Explore the Playground](https://agenticjs.com)

## Why AgenticJS?

In a landscape dominated by Python frameworks, JavaScript developers have often found themselves at a disadvantage. AgenticJS is here to change that by providing a robust, easy-to-use AI multi-agent framework tailored for the JavaScript ecosystem.

### Key Features

- **Role-Based Agent Design:** Design agents with specific roles and goals.
- **Autonomous Inter-Agent Delegation:** Enable agents to delegate tasks autonomously.
- **Flexible Task Management:** Define and assign tasks dynamically to agents.
- **Real-Time Visualizer:** Built-in UI visualizer for development and debugging.
- **Browser and Server Compatibility:** Works seamlessly across client and server environments.

## Getting Started

Install AgenticJS via npm:

```bash
npm install agenticjs --save
```

Set your LLM API key as an environment variable:
```bash
export ANTHROPIC_API_KEY='your-api-key'
```

Import AgenticJS in your JavaScript file:

```js
import { Agent, Task, Team } from 'agenticjs';
```

## Example Usage

Define agents, tasks, and a team to manage them:

```js
import { Agent, Task, Team } from 'agenticjs';

// ╔══════════════════════════════════════════════════════╗
// ║ How to Use AgenticJS:                                ║
// ║ 1. Define your Agents with specific roles and goals  ║
// ║ 2. Define the Tasks each Agent will perform          ║ 
// ║ 3. Create the Team and assign Agents and their Tasks ║
// ║ 4. Start the Team to execute the defined tasks       ║
// ╚══════════════════════════════════════════════════════╝

// ──── Agents ────────────────────────────────────────────
// ─ Agents are autonomous entities designed to perform
// ─ specific roles and achieve goals based on the
// ─ tasks assigned to them.
// ────────────────────────────────────────────────────────

const profileAnalyst = new Agent({
    name: 'Ivy', 
    role: 'Profile Analyst', 
    goal: 'Extract structured information from conversational user input.', 
    background: 'Data Processor',
    tools: [],  // Tools are omitted for now
    llmConfig: {
        provider: "anthropic",  // or "openai"
        model: "claude-3-5-sonnet-20240620",
        temperature: 0.9,
        maxTokens: 1024,
        anthropicApiUrl: "https://www.agenticjs.com/proxy/anthropic",
    }    
});

const formatter = new Agent({
    name: 'Formy', 
    role: 'Formatter', 
    goal: 'Format structured information into a professional resume.', 
    background: 'Document Formatter',
    tools: [],
    llmConfig: {
        provider: "anthropic",  // or "openai"
        model: "claude-3-5-sonnet-20240620",
        temperature: 0.9,
        maxTokens: 1024,
        anthropicApiUrl: "https://www.agenticjs.com/proxy/anthropic",
    }    
});

const reviewer = new Agent({
    name: 'Revy', 
    role: 'Reviewer', 
    goal: 'Review and polish the final resume.', 
    background: 'Quality Assurance Specialist',
    tools: [],
    llmConfig: {
        provider: "anthropic",  // or "openai"
        model: "claude-3-5-sonnet-20240620",
        temperature: 0.9,
        maxTokens: 1024,
        anthropicApiUrl: "https://www.agenticjs.com/proxy/anthropic",
    }    
});

// ──── Tasks ─────────────────────────────────────────────
// ─ Tasks define the specific actions each agent must
// ─ take, their expected outputs, and mark critical
// ─ outputs as deliverables if they are the final
// ─ products.
// ────────────────────────────────────────────────────────

const processingTask = new Task({ 
    description: `Extract relevant details such as name, experience, skills, and job history from the user's 'aboutMe' input. 
    aboutMe: {aboutMe}`,
    expectedOutput: 'Structured data ready for formatting.', 
    agent: profileAnalyst
});

const formattingTask = new Task({ 
    description: `Use the extracted information to create a clean, professional resume layout tailored for a JavaScript Developer.`,
    expectedOutput: 'A well-formatted resume in PDF format.', 
    agent: formatter 
});

const reviewTask = new Task({ 
    description: `Ensure the resume is error-free, engaging, and meets professional standards.`,
    expectedOutput: 'A polished, final resume ready for job applications. Please do not give any feedback on the resume. Just the final resume.', 
    agent: reviewer 
});

// ──── Team ────────────────────────────────────────────
// ─ The Team coordinates the agents and their tasks.
// ─ It starts with an initial input and manages the
// ─ flow of information between tasks.
// ──────────────────────────────────────────────────────

const team = new Team({
    name: 'Resume Creation Team',
    agents: [profileAnalyst, formatter, reviewer],
    tasks: [processingTask, formattingTask, reviewTask],
    inputs: { aboutMe: 'My name is Will, I have been a Javascript Developer for 3 years. I know React, NextJS, and REDUX. My latest job was as a Junior Developer at Disney creating UIs for the main landing page.' },  // Initial input for the first task
});

// Start the team: This initiates the sequence of tasks as defined, leading to the generation of the final deliverable.
team.start();


```

## Documentation

- [Official Documentation](https://agenticjs.com)
- [Join Our Discord](https://bit.ly/JoinAIChamps)

### Compatibility

AgenticJS is compatible with major front-end frameworks like React, Vue, Angular, and NextJS, making it a versatile choice for developers.

### Community and Support

Join our [Discord community](https://bit.ly/JoinAIChamps) to connect with other developers and get support. [Follow us](https://x.com/dariel_noel) on Twitter for the latest updates.

### Contributing

We welcome contributions from the community. Please read our contributing guidelines before submitting pull requests.

### License

AgenticJS is MIT licensed.