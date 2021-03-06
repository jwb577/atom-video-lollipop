'use babel';

import Peer from 'peerjs'
import _ from 'underscore-plus'
import { PEER_KEY } from './constants'

import { getStore, getRoot, togglePanel } from '../utils/render'
import { destroyLogin } from '../actions/login'

import {
  callRequest,
  callRequestEnded,
  callingEnded,
  addStream,
  removeStream,
  callStarted,
  callEnded,
  destroySession,
} from '../actions/session'

export default class Session {

  constructor(username) {
    this.peer = new Peer(username, {key: PEER_KEY})
    this.username = username
    this.connections = []
    this.inSession = false

    this.peer.on('connection', (connection) => {

      connection.on('open', () => {
        console.log("Opened connection with id:", connection.peer)
      })

      connection.on('data', (data) => {
        if(data.type == "callRequest") {

          if (getRoot().hidden) {
            togglePanel()
          }

          getStore().dispatch(callRequest(connection))
          if (this.inSession) {
            console.log("In session, declining..")
            connection.send({type: "callDeclined"})
          }
        } else if (data.type == "callPeers") {
          console.log("Received peer ids", data.peerIds)
          let peerIds = data.peerIds
          peerIds.push(connection.peer)
          if(peerIds) {
            _.each(peerIds, (id) => {
              if (!this.checkIfConnectionExists(id)) {
                this.getMedia({audio: true, video: true}, (stream) => {
                  let call = this.peer.call(id, stream);

                  call.on('stream', (stream) => {
                    this.inSession = true
                    getStore().dispatch(callStarted())
                    getStore().dispatch(addStream(call.peer, stream))
                    this.addToConnections(call)
                  })

                  call.on('close', () => {
                    this.removeFromConnections(call)
                    getStore().dispatch(removeStream(call.peer))
                    if (!this.connectionsToPeerIds().length) {
                      getStore().dispatch(callEnded())
                      getStore().dispatch(callingEnded(3))
                      this.inSession = false
                    }
                  })

                  call.on('error', (err) => {})
                })
              }
            })
          }
        }
      })

      connection.on('close', () => {})

    })

    this.peer.on('call', (call) => {
      // check existing calls if not
      this.getMedia({audio: true, video: true}, (stream) => {
        call.answer(stream)
        this.addToConnections(call)
      })

      call.on('stream', (stream) => {
        this.inSession = true
        getStore().dispatch(callStarted())
        getStore().dispatch(addStream(call.peer, stream))
        // add media to maincontainer
      })

      call.on('close', () => {
        this.removeFromConnections(call)
        getStore().dispatch(removeStream(call.peer))
        if (!this.connectionsToPeerIds().length) {
          getStore().dispatch(callEnded())
          getStore().dispatch(callingEnded(3))
          this.inSession = false
        }
      })

      call.on('error', (err) => {
        console.log(err)
        this.removeFromConnections(call)
      })

    })

    this.peer.on('error', (err) => {
      console.log(err.type)
      switch (err.type) {
        case 'unavailable-id':
          getStore().dispatch(callingEnded(4))
          this.destroy()
          getStore().dispatch(destroyLogin())
          break;
        case 'network':
          break
        case 'peer-unavailable':
          getStore().dispatch(callingEnded(6))
          break
        default:
      }
    })

  }

  connect(peerId) {
    if (this.username == peerId) {
      getStore().dispatch(callingEnded(0))
      return
    }

    let connection = this.peer.connect(peerId)

    connection.on('open', () => {
      connection.send({type: "callRequest"})
    })

    connection.on('data', (data) => {
      if (data.type == "callAccepted") {
        getStore().dispatch(callingEnded(1))
        let peerIds = this.connectionsToPeerIds(this.connections)
        console.log("Sending existing connections", peerIds)
        connection.send({type: "callPeers", peerIds: peerIds})
      }else if (data.type == "callDeclined") {
        getStore().dispatch(callingEnded(2))
        connection.close()
      }
    })

    connection.on('close', () => {
      getStore().dispatch(callingEnded(0))
    })

    connection.on('error', (err) => {
      console.log(err)
      getStore().dispatch(callingEnded(3))
    })
  }

  answerCall(answerObj) {
    if(answerObj.answer == 1) {
      answerObj.connection.send({type: "callAccepted"})
    } else if(answerObj.answer == 2){
      answerObj.connection.send({type: "callDeclined"})
    }
  }

  exitCall() {
    _.each(this.connections, (connection) => {
      connection.close()
    })
    this.connections = []
  }

  connectionsToPeerIds(connections) {
    return _.map(connections, (c) => { return c.peer })
  }

  checkIfConnectionExists(id) {
    return _.contains(this.connectionsToPeerIds(this.connections), id);
  }

  addToConnections(connection) {
    this.connections.push(connection)
    console.log("Connections updated (",connection.peer,"added) :", this.connections)
  }

  removeFromConnections(connection) {
    this.connections = _.filter(this.connections, (c) => c.peer != connection.peer)
    console.log("Connections updated (",connection.peer,"removed) :", this.connections)
  }

  getMedia(options, success) {
    navigator.webkitGetUserMedia(options, success, (err) => {console.log(err)});
  }

  destroy() {
    this.peer.destroy()
  }
}
