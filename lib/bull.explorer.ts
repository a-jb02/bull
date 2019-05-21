import {
  Injectable as InjectableDecorator,
  Type,
  Logger,
} from '@nestjs/common';
import { ModulesContainer, ModuleRef } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { Module } from '@nestjs/core/injector/module';
import {
  BULL_MODULE_QUEUE,
  BULL_MODULE_QUEUE_PROCESS,
  BULL_MODULE_ON_QUEUE_EVENT,
} from './bull.constants';
import { Injectable } from '@nestjs/common/interfaces';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { getQueueToken } from './bull.utils';
import { Queue } from 'bull';

@InjectableDecorator()
export class BullExplorer {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly modulesContainer: ModulesContainer,
    private readonly logger: Logger,
  ) {}

  explore() {
    const components = BullExplorer.getQueueComponents([
      ...this.modulesContainer.values(),
    ]);
    components.map((wrapper: InstanceWrapper) => {
      const { instance, metatype } = wrapper;
      const queueName = BullExplorer.getQueueComponentMetadata(metatype).name;
      const queueToken = getQueueToken(queueName);
      let queue: Queue;
      try {
        queue = BullExplorer.getQueue(this.moduleRef, queueToken);
      } catch (err) {
        this.logger.error(
          queueName
            ? `No Queue was found with the given name (${queueName}). Check your configuration.`
            : 'No Queue was found. Check your configuration.',
        );
        throw err;
      }
      new MetadataScanner().scanFromPrototype(
        instance,
        Object.getPrototypeOf(instance),
        (key: string) => {
          if (BullExplorer.isProcessor(instance, key)) {
            BullExplorer.handleProcessor(
              instance,
              key,
              queue,
              BullExplorer.getProcessorMetadata(instance, key),
            );
          } else if (BullExplorer.isListener(instance, key)) {
            BullExplorer.handleListener(
              instance,
              key,
              queue,
              BullExplorer.getListenerMetadata(instance, key),
            );
          }
        },
      );
    });
  }

  static handleProcessor(instance, key, queue, options?) {
    const args = [
      options ? options.name : undefined,
      options ? options.concurrency : undefined,
      instance[key].bind(instance)
    ].filter(arg => !!arg);
    queue.process(...args);
  }

  static handleListener(instance, key, queue, options) {
    queue.on(options.eventName, instance[key].bind(instance));
  }

  static isQueueComponent(metatype: Type<Injectable>): boolean {
    return Reflect.hasMetadata(BULL_MODULE_QUEUE, metatype);
  }

  static getQueueComponentMetadata(metatype: Type<Injectable>): any {
    return Reflect.getMetadata(BULL_MODULE_QUEUE, metatype);
  }

  static isProcessor(instance: Injectable, methodKey: string): boolean {
    return Reflect.hasMetadata(BULL_MODULE_QUEUE_PROCESS, instance, methodKey);
  }

  static isListener(instance: Injectable, methodKey: string): boolean {
    return Reflect.hasMetadata(BULL_MODULE_ON_QUEUE_EVENT, instance, methodKey);
  }

  static getProcessorMetadata(
    instance: Injectable,
    methodKey: string,
  ): any {
    return Reflect.getMetadata(BULL_MODULE_QUEUE_PROCESS, instance, methodKey);
  }

  static getListenerMetadata(
    instance: Injectable,
    methodKey: string,
  ): any {
    return Reflect.getMetadata(BULL_MODULE_ON_QUEUE_EVENT, instance, methodKey);
  }

  static getQueue(moduleRef: ModuleRef, queueToken: string): Queue {
    return moduleRef.get<Queue>(queueToken);
  }

  static getQueueComponents(
    modules: Module[],
  ): InstanceWrapper<Injectable>[] {
    return modules
      .map(
        (module: Module) =>
          module.components,
      )
      .reduce((acc, map) => {
        acc.push(...map.values());
        return acc;
      }, [])
      .filter(
        (wrapper: InstanceWrapper) =>
          wrapper.metatype && BullExplorer.isQueueComponent(wrapper.metatype),
      );
  }
}