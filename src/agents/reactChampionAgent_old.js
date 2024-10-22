/**
 * C:\Users\pwalc\Documents\GroqEmailAssistant\KaibanJS\src\agents\reactChampionAgent.js
 *  Enhanced ReAct Agent Implementation.
 *
 * This file implements the ReactChampionAgent, a variation of the traditional ReAct (Reasoning and Action) agent model,
 * tailored to enhance the agent's capabilities through iterative feedback loops. Unlike the original ReAct pattern that typically 
 * follows a linear execution path, our Reflex Act model introduces a round-trip communication process, enabling continuous refinement 
 * and fine-tuning of actions based on real-time feedback.
 *
 * This enhanced approach allows the agent to dynamically adjust its strategies and responses, significantly improving adaptability 
 * and decision-making accuracy in complex scenarios. The model is designed for environments where ongoing interaction and meticulous 
 * state management are crucial.
 *
 * Usage:
 * Deploy this agent in applications that demand high levels of interaction and precise control over state transitions, ensuring 
 * optimal performance and nuanced agent behavior.
 */

import { BaseAgent } from './baseAgent';
import { getApiKey } from '../utils/agents';
import { getParsedJSON } from '../utils/parser';
import { AGENT_STATUS_enum } from '../utils/enums';
import { interpolateTaskDescription } from '../utils/tasks';
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatGroq } from "@langchain/groq"; // Add this import
import { SystemMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import CustomMessageHistory from '../utils/CustomMessageHistory';
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { logger } from "../utils/logger";
import { LLMInvocationError } from '../utils/errors';

class ReactChampionAgent extends BaseAgent {
    #executableAgent;
    constructor(config) {
        super(config);
        this.messageHistory = new CustomMessageHistory();
    }

    get executableAgent() {
        return {};
    }

    initialize(store, env) {
        this.store = store;
        this.env = env;

        if (!this.llmInstance) {
            const apiKey = getApiKey(this.llmConfig, this.env);
            if (!apiKey && !this.llmConfig.apiBaseUrl) {
                throw new Error('API key is missing. Please provide it through the Agent llmConfig or through the team env variable.');
            }
            this.llmConfig.apiKey = apiKey;

            const providers = {
                anthropic: ChatAnthropic,
                google: ChatGoogleGenerativeAI,
                mistral: ChatMistralAI,
                openai: ChatOpenAI,
                groq: ChatGroq, // Add Groq to the providers
            };

            const ChatClass = providers[this.llmConfig.provider] || ChatOpenAI;
            this.llmInstance = new ChatClass(this.llmConfig);
        } else {
            const extractedLlmConfig = {
                ...this.llmInstance.lc_kwargs,
                provider: this.llmInstance.lc_namespace[this.llmInstance.lc_namespace.length - 1]
            };
            this.llmConfig = extractedLlmConfig;
        }
    }

    async workOnTask(task, inputs, context) {
        const config = this.prepareAgentForTask(task, inputs, context);
        this.#executableAgent = config.executableAgent;
        return await this.agenticLoop(this, task, this.#executableAgent, config.initialFeedbackMessage);
    }

    async workOnFeedback(task, feedbackList, context) {
        const feedbackString = feedbackList.map(f => f.content).join(', ');
        const feedbackMessage = this.promptTemplates.WORK_ON_FEEDBACK_FEEDBACK({
            agent: this,
            task,
            feedback: feedbackString,
            context
        });
        return await this.agenticLoop(this, task, this.#executableAgent, feedbackMessage);
    }

    handleTaskCompleted({ agent, task, parsedResultWithFinalAnswer, iterations, maxAgentIterations }) {
        if (!task.feedbackHistory) {
            task.feedbackHistory = [];
        }
        agent.store.getState().handleAgentTaskCompleted({
            agent, 
            task, 
            result: parsedResultWithFinalAnswer.finalAnswer, 
            iterations, 
            maxAgentIterations
        });    
    }

    prepareAgentForTask(task, inputs, context) {
        const interpolatedDescription = interpolateTaskDescription(task.description, inputs);
        const systemMessage = this.buildSystemMessage(this, task, interpolatedDescription);
        const feedbackMessage = this.buildInitialMessage(this, task, interpolatedDescription, context);
        this.llmSystemMessage = systemMessage;

        const promptAgent = ChatPromptTemplate.fromMessages([
            new SystemMessage(systemMessage),
            ["placeholder", "{chat_history}"],
            ["human", "{feedbackMessage}"],
        ]);

        const chainAgent = promptAgent.pipe(this.llmInstance);
        const chainAgentWithHistory = new RunnableWithMessageHistory({
            runnable: chainAgent,
            getMessageHistory: () => this.messageHistory,
            inputMessagesKey: "feedbackMessage",
            historyMessagesKey: "chat_history",
        });

        return {
            executableAgent: chainAgentWithHistory,
            initialFeedbackMessage: feedbackMessage
        };
    }  

    async agenticLoop(agent, task, ExecutableAgent, initialMessage) {  
        let feedbackMessage = initialMessage;
        let parsedResultWithFinalAnswer = null;
        let iterations = 0;
        const maxAgentIterations = agent.maxIterations;
        let loopCriticalError = null;

        while (!parsedResultWithFinalAnswer && iterations < maxAgentIterations && !loopCriticalError) {
            try {
                agent.handleIterationStart({agent: agent, task, iterations, maxAgentIterations});

                if (agent.forceFinalAnswer && iterations === maxAgentIterations - 2) {
                    feedbackMessage = this.promptTemplates.FORCE_FINAL_ANSWER_FEEDBACK({
                        agent,
                        task,
                        iterations,
                        maxAgentIterations
                    });
                }                

                const thinkingResult = await this.executeThinking(agent, task, ExecutableAgent, feedbackMessage);
                const parsedLLMOutput = thinkingResult.parsedLLMOutput;

                const actionType = this.determineActionType(parsedLLMOutput);

                switch (actionType) {
                    case AGENT_STATUS_enum.ISSUES_PARSING_LLM_OUTPUT:
                        feedbackMessage = this.handleIssuesParsingLLMOutput({agent: agent, task, output: thinkingResult});
                        break;
                    case AGENT_STATUS_enum.FINAL_ANSWER:
                        parsedResultWithFinalAnswer = this.handleFinalAnswer({agent: agent, task, parsedLLMOutput});
                        break;
                    case AGENT_STATUS_enum.THOUGHT:
                        feedbackMessage = this.handleThought({agent: agent, task, parsedLLMOutput});
                        break;
                    case AGENT_STATUS_enum.SELF_QUESTION:
                        feedbackMessage = this.handleSelfQuestion({agent: agent, task, parsedLLMOutput});
                        break;
                    case AGENT_STATUS_enum.EXECUTING_ACTION:
                        logger.debug(`⏩ Agent ${agent.name} will be ${AGENT_STATUS_enum.EXECUTING_ACTION}...`);
                        const toolName = parsedLLMOutput.action;
                        const tool = this.tools.find(tool => tool.name === toolName);
                        if (tool) {
                            try {
                                feedbackMessage = await this.executeUsingTool({agent: agent, task, parsedLLMOutput, tool});
                            } catch (error) {
                                feedbackMessage = this.handleUsingToolError({agent: agent, task, parsedLLMOutput, tool, error});
                            }
                        } else {
                            feedbackMessage = this.handleToolDoesNotExist({agent: agent, task, parsedLLMOutput, toolName });
                        }
                        break;
                    case AGENT_STATUS_enum.OBSERVATION:
                        feedbackMessage = this.handleObservation({agent: agent, task, parsedLLMOutput});
                        break;
                    case AGENT_STATUS_enum.WEIRD_LLM_OUTPUT:
                        feedbackMessage = this.handleWeirdOutput({agent:agent, task, parsedLLMOutput});
                        break;
                    default:
                        logger.warn(`Unhandled agent status: ${actionType}`);
                        break;
                }
                
                this.messageHistory.addMessage({
                    role: actionType === AGENT_STATUS_enum.FINAL_ANSWER ? 'assistant' : 'user',
                    content: feedbackMessage
                });

            } catch (error) {
                if (error.name === 'LLMInvocationError') {
                    agent.handleThinkingError({ agent: agent, task, error });
                } else {
                    this.handleAgenticLoopError({agent: agent, task, error, iterations, maxAgentIterations});
                }
            
                loopCriticalError = error;
                break;
            }
            agent.handleIterationEnd({agent: agent, task, iterations, maxAgentIterations});
            iterations++;      
        }
    
        if (loopCriticalError) {
            return {
                error: "Execution stopped due to a critical error: " + loopCriticalError.message,
                metadata: { iterations, maxAgentIterations }
            };
        } else if (parsedResultWithFinalAnswer) {
            this.handleTaskCompleted({agent: agent, task, parsedResultWithFinalAnswer, iterations, maxAgentIterations});
            return {
                result: parsedResultWithFinalAnswer,
                metadata: { iterations, maxAgentIterations }
            };
        } else if (iterations >= maxAgentIterations) {
            this.handleMaxIterationsError({agent: agent, task, iterations, maxAgentIterations});
            return {
                error: "Task incomplete: reached maximum iterations without final answer.",
                metadata: { iterations, maxAgentIterations }
            };
        } else {
            return {
                error: "Execution terminated unexpectedly without results.",
                metadata: { iterations, maxAgentIterations }
            };
        }
    }

    buildSystemMessage(agent, task, interpolatedTaskDescription) {
        return this.promptTemplates.SYSTEM_MESSAGE({
            agent,
            task: {
                ...task,
                description: interpolatedTaskDescription
            }
        });
    }

    buildInitialMessage(agent, task, interpolatedTaskDescription, context) {
        return this.promptTemplates.INITIAL_MESSAGE({
            agent,
            task: {
                ...task,
                description: interpolatedTaskDescription
            },
            context
        });
    }

    determineActionType (parsedResult) {
        if (parsedResult === null) {
            return AGENT_STATUS_enum.ISSUES_PARSING_LLM_OUTPUT;
        } else if (parsedResult.finalAnswer) {
            return AGENT_STATUS_enum.FINAL_ANSWER;
        } else if (parsedResult.action === "self_question") {
            return parsedResult.thought ? AGENT_STATUS_enum.THOUGHT : AGENT_STATUS_enum.SELF_QUESTION;
        } else if (parsedResult.action) {
            return AGENT_STATUS_enum.EXECUTING_ACTION; // Assume actions need to execute a tool or similar
        } else if (parsedResult.observation) {
            return AGENT_STATUS_enum.OBSERVATION;
        } else {
            return AGENT_STATUS_enum.WEIRD_LLM_OUTPUT; // Fallback for unhandled or unexpected output
        }
    }

    handleIterationStart({agent, task, iterations, maxAgentIterations}) {
        agent.store.getState().handleAgentIterationStart({agent, task, iterations, maxAgentIterations});
    }

    handleIterationEnd({agent, task, iterations, maxAgentIterations}) {
        agent.store.getState().handleAgentIterationEnd({agent, task, iterations, maxAgentIterations});
    }
    async handleThinkingStart({ agent, task, messages }) {
        try {
            const transformedMessages = messages.flatMap(subArray =>
                subArray.map(message => ({
                    type: message.constructor.name,
                    content: message.content
                }))
            );
            agent.store.getState().handleAgentThinkingStart({agent, task, messages: transformedMessages});
            return transformedMessages;
        } catch (error) {
            // TODO: Checkout the Errors waterfall handling
            logger.debug(`AGENT/handleThinkingStart: Error processing thinking messages: ${error.message}`);
            throw error;  // Rethrow to ensure it can still be handled upstream if necessary
        }
    }
    
    async handleThinkingEnd({ agent, task, output }) {
        try {
            const agentResultParser = new StringOutputParser();
            if (!output.generations || !output.generations[0] || !output.generations[0][0].message) {
                throw new Error('Invalid output structure');
            }

            const { message } = output.generations[0][0];
            const parsedResult = await agentResultParser.invoke(message);
            const parsedLLMOutput = getParsedJSON(parsedResult);
            const thinkingResult = {
                parsedLLMOutput: parsedLLMOutput,
                llmOutput: parsedResult,
                llmUsageStats: {
                    inputTokens: message.usage_metadata?.input_tokens ?? -1,
                    outputTokens: message.usage_metadata?.output_tokens ?? -1
                }
            };
            agent.store.getState().handleAgentThinkingEnd({agent, task, output: thinkingResult});
            return thinkingResult;
        } catch (error) {
            logger.debug(`AGENT/handleThinkingEnd: Error processing thinking result: ${error}`);
            throw error;  // Rethrow to ensure it can still be handled upstream if necessary
        }
    }

    handleThinkingError({ agent, task, error }) {  
        agent.store.getState().handleAgentThinkingError({agent, task, error});
    }

    async executeThinking(agent, task, ExecutableAgent, feedbackMessage) {
        return new Promise((resolve, reject) => {
            ExecutableAgent.invoke(
                { feedbackMessage },
                {
                    "configurable": { "sessionId": "foo-bar-baz" },
                    callbacks: [{
                        handleChatModelStart: (llm, messages) => {
                            agent.handleThinkingStart({ agent, task, messages }).catch(error => {
                                reject(error);
                            });
                        },
    
                        handleLLMEnd: async (output) => {
                            agent.handleThinkingEnd({ agent, task, output })
                                .then(thinkingResult => {
                                    this.messageHistory.addMessage({
                                        role: 'assistant',
                                        content: thinkingResult.llmOutput
                                    });
                                    resolve(thinkingResult);
                                })
                                .catch(error => {
                                    reject(error);
                                });
                        }
                    }]
                }
            ).catch(error => {
                logger.error(`LLM_INVOCATION_ERROR: Error during LLM API call for Agent: ${agent.name}, Task: ${task.id}. Details:`, error);
                reject(new LLMInvocationError(`LLM API Error during executeThinking for Agent: ${agent.name}, Task: ${task.id}`, error));
            });
        });
    }
    
    handleIssuesParsingLLMOutput({agent, task, output}) { 
        const jSONPArsingError = new Error('Received an invalid JSON object from the LLM. Requesting a correctly formatted JSON response.', output.llmOutput);
        agent.store.getState().handleAgentIssuesParsingLLMOutput({agent, task, output, error: jSONPArsingError});
        const feedbackMessage = this.promptTemplates.INVALID_JSON_FEEDBACK({
            agent,
            task,
            llmOutput: output.llmOutput
        });
        return feedbackMessage;
    }

    handleFinalAnswer({agent, task, parsedLLMOutput}) {
        // console.log(parsedJSON.finalAnswer);
        if (parsedLLMOutput.finalAnswer) {
            if (typeof parsedLLMOutput.finalAnswer === 'object' && parsedLLMOutput.finalAnswer !== null) {
                parsedLLMOutput.finalAnswer = JSON.stringify(parsedLLMOutput.finalAnswer);
            }
        }
        agent.store.getState().handleAgentFinalAnswer({agent, task, output: parsedLLMOutput});
        return parsedLLMOutput;
    }

    handleThought({agent, task, parsedLLMOutput}) {
        agent.store.getState().handleAgentThought({agent, task, output: parsedLLMOutput});
        let feedbackMessage =  this.promptTemplates.THOUGHT_FEEDBACK({
            agent,
            task,
            thought: parsedLLMOutput.thought,
            parsedLLMOutput
        });
        if(parsedLLMOutput.action === 'self_question' && parsedLLMOutput.actionInput) {
            const actionAsString = typeof parsedLLMOutput.actionInput == 'object' ? JSON.stringify(parsedLLMOutput.actionInput) : parsedLLMOutput.actionInput;
            feedbackMessage = this.promptTemplates.THOUGHT_WITH_SELF_QUESTION_FEEDBACK({
                agent,
                task,
                thought: parsedLLMOutput.thought,
                question: actionAsString,
                parsedLLMOutput
            });
        }
        return feedbackMessage;
    }

    handleSelfQuestion({agent, task, parsedLLMOutput}) {
        agent.store.getState().handleAgentSelfQuestion({agent, task, output: parsedLLMOutput});
        const feedbackMessage = this.promptTemplates.SELF_QUESTION_FEEDBACK({
            agent,
            task,
            question: parsedLLMOutput.thought,
            parsedLLMOutput
        });
        return feedbackMessage;
    }

    async executeUsingTool({agent, task, parsedLLMOutput, tool}) {
        // If the tool exists, use it
        const toolInput = parsedLLMOutput.actionInput;
        agent.handleUsingToolStart({agent, task, tool, input: toolInput});
        const toolResult = await tool.call(toolInput);
        agent.handleUsingToolEnd({agent, task, tool, output: toolResult});
        // console.log(toolResult);
        const feedbackMessage = this.promptTemplates.TOOL_RESULT_FEEDBACK({
            agent,
            task,
            toolResult,
            parsedLLMOutput
        });
        return feedbackMessage;
    }

    handleUsingToolStart({agent, task, tool, input}) {
        agent.store.getState().handleAgentToolStart({agent, task, tool, input});
    }
    handleUsingToolEnd({agent, task, tool, output}) {
        agent.store.getState().handleAgentToolEnd({agent, task, tool, output});
    }

    handleUsingToolError({agent, task, parsedLLMOutput, tool, error}) {
        agent.store.getState().handleAgentToolError({agent, task, tool, error});
        // console.error(`Error occurred while using the tool ${parsedLLMOutput.action}:`, error);
        const feedbackMessage = this.promptTemplates.TOOL_ERROR_FEEDBACK({
            agent,
            task,
            toolName: parsedLLMOutput.action,
            error,
            parsedLLMOutput
        });
        return feedbackMessage;
    }

    handleToolDoesNotExist({agent, task, parsedLLMOutput, toolName}) {
        agent.store.getState().handleAgentToolDoesNotExist({agent, task, toolName});
        const feedbackMessage = this.promptTemplates.TOOL_NOT_EXIST_FEEDBACK({
            agent,
            task,
            toolName: parsedLLMOutput.action,
            parsedLLMOutput
        });
        return feedbackMessage;
    }

    handleObservation({agent, task, parsedLLMOutput}) {
        agent.store.getState().handleAgentObservation({agent, task, output: parsedLLMOutput});
        const feedbackMessage = this.promptTemplates.OBSERVATION_FEEDBACK({
            agent,
            task,
            parsedLLMOutput
        });
        return feedbackMessage;
    }

    handleWeirdOutput({agent, task, parsedLLMOutput}) {
        agent.store.getState().handleWeirdOutput({agent, task, output: parsedLLMOutput});
        const feedbackMessage = this.promptTemplates.WEIRD_OUTPUT_FEEDBACK({
            agent,
            task,
            parsedLLMOutput
        });
        return feedbackMessage;
    }

    handleAgenticLoopError({agent, task, error, iterations, maxAgentIterations}) {
        agent.store.getState().handleAgentLoopError({agent, task, error, iterations, maxAgentIterations});
    }

    handleMaxIterationsError({agent, task, iterations, maxAgentIterations}) {
        const error = new Error(`Agent ${agent.name} reached the maximum number of iterations: [${maxAgentIterations}] without finding a final answer.`);
        agent.store.getState().handleAgentMaxIterationsError({agent, task, error, iterations, maxAgentIterations});
    }

    handleTaskCompleted({agent, task, parsedResultWithFinalAnswer, iterations, maxAgentIterations}) {
        agent.store.getState().handleAgentTaskCompleted({agent, task, result: parsedResultWithFinalAnswer.finalAnswer, iterations, maxAgentIterations});    
    }   
}

export { ReactChampionAgent };